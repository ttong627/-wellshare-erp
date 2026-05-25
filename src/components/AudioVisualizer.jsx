import { useRef, useEffect } from 'react';

/* AUDIO VISUALIZER — 실시간 마이크 캔버스 웜톤 비주얼라이저 */
export function AudioVisualizer({ isRecording, isBoosting, analyserRef, dataArrayRef }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (!isRecording) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      let data = [];
      if (analyserRef?.current && dataArrayRef?.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        data = Array.from(dataArrayRef.current).slice(0, 32);
      }
      if (data.length === 0) data = new Array(16).fill(0);

      const ampFactor = isBoosting ? 1.8 : 1.0;
      const grad = ctx.createLinearGradient(0, height, 0, 0);
      if (isBoosting) {
        grad.addColorStop(0, 'hsla(18, 86%, 50%, 0.1)');
        grad.addColorStop(0.5, 'hsla(24, 90%, 65%, 0.8)');
        grad.addColorStop(1, 'hsla(36, 100%, 75%, 1.0)');
      } else {
        grad.addColorStop(0, 'hsla(20, 48%, 68%, 0.1)');
        grad.addColorStop(0.5, 'hsla(22, 50%, 58%, 0.7)');
        grad.addColorStop(1, 'hsla(24, 60%, 65%, 0.9)');
      }
      ctx.fillStyle = grad;
      ctx.shadowBlur = isBoosting ? 15 : 0;
      ctx.shadowColor = 'rgba(201, 122, 83, 0.8)';

      const barCount = data.length;
      const barWidth = (width / barCount) - 3;
      for (let i = 0; i < barCount; i++) {
        const val = (data[i] / 255) * height * 0.8 * ampFactor;
        const barHeight = Math.max(4, val);
        const x = i * (barWidth + 3);
        const y = (height - barHeight) / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 6);
        ctx.fill();
      }
    };

    draw();
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isRecording, isBoosting, analyserRef, dataArrayRef]);

  return (
    <div className={'audio-visualizer-container ' + (isBoosting ? 'boosting' : '')}>
      <canvas
        ref={canvasRef}
        width={300}
        height={80}
        className="visualizer-canvas"
      />
    </div>
  );
}
