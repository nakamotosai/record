import { useState, useCallback, useEffect } from 'react';
import './index.css';
import RegionSelector from './components/RegionSelector';
import RecordingPanel from './components/RecordingPanel';
import BackgroundRecorder from './components/BackgroundRecorder';

type AppMode = 'clipboard' | 'file' | 'record' | 'recording' | 'recorder';

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor?: number;
}

function App() {
  const [mode, setMode] = useState<AppMode>('clipboard');
  const [recordingRect, setRecordingRect] = useState<SelectionRect | null>(null);

  useEffect(() => {
    // 全局错误捕获
    window.onerror = (message, source, lineno, colno, error) => {
      const msg = `[Global Error]: ${message} at ${source}:${lineno}:${colno}`;
      console.error(msg);
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log(msg);
        if (error && error.stack) window.electronAPI.log(error.stack);
      }
    };

    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get('mode') as AppMode;
    if (urlMode) {
      setMode(urlMode);
      console.log('Mode set to:', urlMode);
    }

    // 监听来自后台 Worker 的停止事件 
    const stopListener = window.electronAPI.onStopRecording(() => {
      console.log('App received stop-recording event');
      setRecordingRect(null);
      setMode('clipboard'); // Reset mode
      window.electronAPI.closeSelector(); // Ensure window closes
    });
    return stopListener;
  }, []);

  const handleCancel = useCallback(async () => {
    try {
      if (mode === 'recording') {
        await window.electronAPI.stopRecordingWorker();
      }
      await window.electronAPI.closeSelector();
    } catch (e) {
      console.error('Close error:', e);
    }
  }, [mode]);

  const handleStartRecording = useCallback(async (rect: SelectionRect) => {
    console.log('Requesting background recording with rect:', rect);
    setRecordingRect(rect);
    setMode('recording');

    // 发送指令给 Main -> Worker，附带 DPI缩放比例
    const rectWithScale = {
      ...rect,
      scaleFactor: window.devicePixelRatio || 1
    };
    await window.electronAPI.startRecordingWorker(rectWithScale);
  }, []);

  const handleStopRecording = useCallback(async () => {
    console.log('Sending stop command to worker');
    await window.electronAPI.stopRecordingWorker();
    setRecordingRect(null);
    await window.electronAPI.closeSelector();
  }, []);

  // 后台录制器模式
  if (mode === 'recorder') {
    return <BackgroundRecorder />;
  }

  // 前台录制 UI
  if (mode === 'recording' && recordingRect) {
    return (
      <RecordingPanel
        rect={recordingRect}
        onStop={() => { }}
        onCancel={handleStopRecording}
        isWorkerMode={true}
      />
    );
  }

  // 选区模式
  return (
    <RegionSelector
      mode={mode === 'recording' || mode === 'recorder' ? 'record' : mode}
      onCancel={handleCancel}
      onStartRecording={handleStartRecording}
    />
  );
}

export default App;
