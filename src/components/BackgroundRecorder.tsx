import React, { useEffect, useRef } from 'react';

const BackgroundRecorder: React.FC = () => {
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null); // New ref for cleanup
    const animationFrameRef = useRef<number | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const log = (msg: string) => {
        console.log(msg);
        if (window.electronAPI && window.electronAPI.log) {
            window.electronAPI.log('[Worker] ' + msg);
        }
    };

    useEffect(() => {
        log('Background Recorder Mounted');

        const handleStart = async (_event: any, rect: any, settings: any) => {
            try {
                log(`Starting recording via Worker. Rect: ${JSON.stringify(rect)}`);

                // CRITICAL: 清理之前的录制状态，确保连续录制正常
                if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                    log('Stopping previous recording...');
                    try { mediaRecorderRef.current.stop(); } catch (e) { }
                }
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(t => t.stop());
                    streamRef.current = null;
                }
                if (animationFrameRef.current) {
                    clearTimeout(animationFrameRef.current);
                    animationFrameRef.current = null;
                }
                chunksRef.current = [];
                log('Previous recording state cleaned up');

                const sourceId = await window.electronAPI.getScreenSourceId();
                if (!sourceId) throw new Error('No source ID');

                // 1. Get Stream
                const constraints: any = {
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: sourceId
                        }
                    }
                };

                const screenStream = await navigator.mediaDevices.getUserMedia(constraints);
                log('Worker getUserMedia success');

                // 2. Setup Canvas
                const sourceScale = rect.scaleFactor || 1;
                const outputScale = 1;

                log(`Scaling: Source=${sourceScale}, Output=${outputScale}`);

                const canvas = document.createElement('canvas');
                canvas.width = Math.floor(rect.width * outputScale) & ~1;
                canvas.height = Math.floor(rect.height * outputScale) & ~1;
                const ctx = canvas.getContext('2d', { alpha: false });
                if (!ctx) throw new Error('Canvas context failed');
                canvasRef.current = canvas;

                // Ensure strictly no audio from the video element (feedback loop prevention)
                const video = document.createElement('video');
                const videoOnlyStream = new MediaStream(screenStream.getVideoTracks());
                video.srcObject = videoOnlyStream;
                video.muted = true;
                video.volume = 0;
                // Store video ref for cleanup if needed
                (videoRef as any).current = video;
                await video.play();

                // 3. Draw Loop
                const draw = () => {
                    if (!ctx || video.paused || video.ended) return;
                    const sx = Math.round(rect.x * sourceScale);
                    const sy = Math.round(rect.y * sourceScale);
                    const sw = Math.round(rect.width * sourceScale);
                    const sh = Math.round(rect.height * sourceScale);
                    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
                    animationFrameRef.current = setTimeout(draw, 1000 / 30) as unknown as number;
                };
                draw();

                // 3. Audio & Stream
                const fps = 30;
                const canvasStream = canvas.captureStream(fps);

                // --- AUDIO SETUP ---
                let sysStreamRef: MediaStream | null = null;
                let micStreamRef: MediaStream | null = null;
                let audioCtxRef: AudioContext | null = null;

                if (settings.audioSource === 'mic') {
                    try {
                        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        canvasStream.addTrack(micStream.getAudioTracks()[0]);
                        micStreamRef = micStream;
                    } catch (e) { log('Mic failed'); }
                } else if (settings.audioSource === 'system') {
                    try {
                        const sysStream = await navigator.mediaDevices.getUserMedia({
                            audio: { mandatory: { chromeMediaSource: 'desktop' } },
                            video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
                        } as any);
                        sysStreamRef = sysStream;

                        // Web Audio API Isolation
                        try {
                            const audioCtx = new AudioContext();
                            audioCtxRef = audioCtx;
                            const source = audioCtx.createMediaStreamSource(sysStream);
                            const dest = audioCtx.createMediaStreamDestination();
                            source.connect(dest);

                            if (dest.stream.getAudioTracks().length > 0) {
                                canvasStream.addTrack(dest.stream.getAudioTracks()[0]);
                            }
                        } catch (audioErr) {
                            log('Web Audio Context setup failed: ' + audioErr);
                        }
                    } catch (e) { log('System audio failed: ' + e); }
                }

                streamRef.current = canvasStream;

                // 4. Recorder
                const mimeType = 'video/webm;codecs=vp8';
                const bitrate = 2500000;

                const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: bitrate });
                // CRITICAL: 每次录制开始时必须清空，避免累积脏数据
                chunksRef.current = [];
                log('Chunks cleared for new recording');

                recorder.ondataavailable = (e) => {
                    log(`ondataavailable fired. data.size: ${e.data.size}`);
                    if (e.data.size > 0) {
                        chunksRef.current.push(e.data);
                        log(`Chunk added. Total chunks: ${chunksRef.current.length}`);
                    } else {
                        log('WARNING: Received empty data chunk');
                    }
                };

                recorder.onstop = async () => {
                    log('Recorder stopped');
                    if (animationFrameRef.current) clearTimeout(animationFrameRef.current);
                    video.pause();
                    video.srcObject = null;

                    // CLEANUP: Stop all tracks
                    screenStream.getTracks().forEach(t => t.stop());

                    if (sysStreamRef) {
                        sysStreamRef.getTracks().forEach(t => t.stop());
                        log('System audio stream closed');
                    }
                    if (micStreamRef) {
                        micStreamRef.getTracks().forEach(t => t.stop());
                        log('Mic stream closed');
                    }
                    if (audioCtxRef) {
                        try { await audioCtxRef.close(); log('AudioContext closed'); } catch (e) { }
                    }

                    log(`Final chunks count: ${chunksRef.current.length}`);
                    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
                    log(`Blob size: ${blob.size} bytes`);
                    const buffer = await blob.arrayBuffer();
                    log(`Buffer size: ${buffer.byteLength} bytes`);
                    await window.electronAPI.recordingFinished(buffer);
                    log('Recording sent to main process');
                };

                mediaRecorderRef.current = recorder;
                // Timeslice removed to ensure single consistent video blob
                recorder.start();
                log('Recording started');

            } catch (err: any) {
                log('Worker Error: ' + err.message + '\n' + err.stack);
            }
        };

        const handleStop = () => {
            log(`handleStop called. Recorder state: ${mediaRecorderRef.current?.state || 'null'}`);
            log(`Chunks count: ${chunksRef.current.length}`);
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
                log('Recorder stop() called');
            } else {
                log('WARNING: Recorder already inactive or null, cannot stop');
            }
        };

        const removeStart = window.electronAPI.onStartRecording(handleStart);
        const removeStop = window.electronAPI.onStopRecording(handleStop);

        return () => {
            removeStart();
            removeStop();
        };
    }, []);

    return <div>Background Recorder Active</div>;
};

export default BackgroundRecorder;
