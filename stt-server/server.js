import express from 'express';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { SpeechClient } from '@google-cloud/speech';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PORT = Number(process.env.PORT || 8080);
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'wellshare-erp';
const REQUIRE_FIREBASE_AUTH = process.env.REQUIRE_FIREBASE_AUTH !== 'false';
const SPEECH_STREAM_RESTART_MS = 270000;

const speechClient = new SpeechClient();
const firebaseJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const app = express();

const DOMAIN_PHRASES = [
  'WS 통합 예약 및 회의록 시스템',
  '광역자활기업',
  '경기자활기업협회',
  '자활기업',
  '자활센터',
  '회의록',
  '회의실',
  '교육장',
  '예약 현황',
  '예약 통계',
  '음성 예약',
  '회의 자료',
  '결정사항',
  '실행 항목',
  '담당자',
  '참석자',
  '예산',
  '일정',
  '보고',
  '검토',
  '승인',
  'Firestore',
  'Firebase',
  'Cloud Run',
  'STT',
  'OCR',
  'WebP',
  'Stitch',
  'Wellshare',
  '워크스페이스',
];

app.get('/healthz', (_, res) => {
  res.json({ ok: true, service: 'mdpj-stt-server' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/stt' });

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

async function verifyFirebaseToken(req) {
  if (!REQUIRE_FIREBASE_AUTH) return { uid: 'anonymous-dev' };
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token') || '';
  if (!token) throw new Error('missing-token');
  const { payload } = await jwtVerify(token, firebaseJwks, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });
  if (!payload.sub) throw new Error('missing-subject');
  return { uid: payload.sub, email: payload.email || null };
}

wss.on('connection', async (ws, req) => {
  let recognizeStream = null;
  let closed = false;
  let uid = null;
  let streamRestartTimer = null;
  let streamGeneration = 0;

  try {
    const decoded = await verifyFirebaseToken(req);
    uid = decoded.uid;
  } catch (err) {
    send(ws, { type: 'error', code: 'auth', message: 'STT 인증에 실패했습니다.' });
    ws.close(1008, 'auth failed');
    return;
  }

  const request = {
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'ko-KR',
      enableAutomaticPunctuation: true,
      enableWordConfidence: true,
      model: 'latest_long',
      useEnhanced: true,
      speechContexts: [
        {
          phrases: DOMAIN_PHRASES,
          boost: 15,
        },
      ],
    },
    interimResults: true,
    singleUtterance: false,
  };

  const stopRecognizeStream = () => {
    if (streamRestartTimer) {
      clearTimeout(streamRestartTimer);
      streamRestartTimer = null;
    }
    if (recognizeStream) {
      const streamToStop = recognizeStream;
      recognizeStream = null;
      try {
        streamToStop.end();
      } catch {
        // ignore
      }
    }
  };

  const startStream = () => {
    stopRecognizeStream();
    if (closed || ws.readyState !== ws.OPEN) return;
    const generation = ++streamGeneration;
    recognizeStream = speechClient
      .streamingRecognize(request)
      .on('error', (err) => {
        if (closed || generation !== streamGeneration) return;
        send(ws, {
          type: 'error',
          code: err.code || 'speech-error',
          message: err.message || 'STT 스트리밍 오류가 발생했습니다.',
        });
        setTimeout(() => {
          if (!closed && ws.readyState === ws.OPEN) startStream();
        }, 500);
      })
      .on('data', (data) => {
        if (generation !== streamGeneration) return;
        const result = data.results?.[0];
        const alternative = result?.alternatives?.[0];
        const transcript = alternative?.transcript?.trim();
        if (!transcript) return;
        send(ws, {
          type: 'transcript',
          text: transcript,
          isFinal: result.isFinal === true,
          confidence: alternative.confidence || 0,
        });
      });

    send(ws, { type: 'ready', uid });
    streamRestartTimer = setTimeout(() => {
      if (!closed && ws.readyState === ws.OPEN) {
        send(ws, { type: 'restarting' });
        startStream();
      }
    }, SPEECH_STREAM_RESTART_MS);
  };

  startStream();

  ws.on('message', (message, isBinary) => {
    if (closed) return;

    if (!isBinary) {
      try {
        const payload = JSON.parse(message.toString());
        if (payload.type === 'pause') {
          send(ws, { type: 'paused' });
        } else if (payload.type === 'resume') {
          send(ws, { type: 'resumed' });
        } else if (payload.type === 'stop') {
          closed = true;
          stopRecognizeStream();
          ws.close(1000, 'normal stop');
        }
      } catch {
        send(ws, { type: 'error', code: 'bad-message', message: '잘못된 STT 메시지입니다.' });
      }
      return;
    }

    if (!recognizeStream) startStream();
    if (!recognizeStream) return;
    try {
      recognizeStream.write(message);
    } catch (err) {
      send(ws, {
        type: 'error',
        code: 'speech-write',
        message: err.message || 'STT audio write failed.',
      });
      startStream();
    }
  });

  ws.on('close', () => {
    closed = true;
    stopRecognizeStream();
  });
});

server.listen(PORT, () => {
  console.log(`STT server listening on ${PORT}`);
});
