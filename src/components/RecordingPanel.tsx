import React, { useState, useEffect, useCallback } from 'react';

interface RecordingPanelProps {
    rect: { x: number; y: number; width: number; height: number };
    onStop: (videoBlob: Blob) => void;
    onCancel: () => void;
    isWorkerMode?: boolean;
}

export const RecordingPanel: React.FC<RecordingPanelProps> = ({ rect, onStop: _onStop, onCancel, isWorkerMode = false }) => {
    const [duration, setDuration] = useState(0);
    const [isPaused] = useState(false);

    // CRITICAL: 启用鼠标穿透，让点击能穿透到桌面
    useEffect(() => {
        window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
        return () => {
            window.electronAPI.setIgnoreMouseEvents(false);
        };
    }, []);

    useEffect(() => {
        if (!isWorkerMode) return;
        const timer = setInterval(() => setDuration(d => d + 1), 1000);
        return () => clearInterval(timer);
    }, [isWorkerMode]);

    // Handle ESC to cancel
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel]);

    // 控制条悬停处理：进入时恢复点击，离开时恢复穿透
    const handleControlMouseEnter = useCallback(() => {
        window.electronAPI.setIgnoreMouseEvents(false);
    }, []);

    const handleControlMouseLeave = useCallback(() => {
        window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
    }, []);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const stop = () => {
        if (isWorkerMode) {
            onCancel();
        }
    };

    // Overlay Style - 添加 pointerEvents: 'none' 确保穿透
    const overlayStyle: React.CSSProperties = {
        position: 'absolute', background: 'rgba(0,0,0,0.5)', zIndex: 99998, pointerEvents: 'none'
    };

    const btnStyle: React.CSSProperties = {
        padding: '8px 16px', border: 'none', borderRadius: '8px', cursor: 'pointer',
        fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px'
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'transparent', zIndex: 99999, pointerEvents: 'none' }}>
            {/* 遮罩层 - 上左右下 */}
            <div style={{ ...overlayStyle, top: 0, left: 0, right: 0, height: rect.y }} />
            <div style={{ ...overlayStyle, top: rect.y, left: 0, width: rect.x, height: rect.height }} />
            <div style={{ ...overlayStyle, top: rect.y, left: rect.x + rect.width, right: 0, height: rect.height }} />
            <div style={{ ...overlayStyle, top: rect.y + rect.height, left: 0, right: 0, bottom: 0 }} />

            {/* 选区高亮边框 - 外扩4px，避免被录进去 */}
            <div style={{
                position: 'absolute',
                left: rect.x - 4, top: rect.y - 4, width: rect.width + 8, height: rect.height + 8,
                border: '3px solid cyan',
                borderRadius: '4px',
                pointerEvents: 'none',
                // boxShadow: '0 0 0 1px rgba(0,0,0,0.5)', // 移除 inset 阴影
                zIndex: 99999
            }} />

            {/* 控制条 - 跟随选区位置，与"开始录制"按钮位置一致 */}
            <div
                onMouseEnter={handleControlMouseEnter}
                onMouseLeave={handleControlMouseLeave}
                style={{
                    position: 'absolute',
                    left: rect.x,
                    // 智能定位：如果底部空间不够，就显示在选区内部的底部
                    top: (rect.y + rect.height + 60 > window.innerHeight)
                        ? rect.y + rect.height - 60
                        : rect.y + rect.height + 12,
                    display: 'flex', alignItems: 'center', gap: '16px',
                    background: 'rgba(20,20,20,0.85)', backdropFilter: 'blur(16px)',
                    padding: '12px 20px', borderRadius: '14px',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
                    zIndex: 100000,
                    pointerEvents: 'auto'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '10px', height: '10px', borderRadius: '50%',
                        background: isPaused ? '#ffa500' : '#ff4757',
                        animation: isPaused ? 'none' : 'pulse 1s infinite'
                    }} />
                    <span style={{ fontFamily: 'monospace', color: '#fff', fontSize: '16px', minWidth: '50px' }}>
                        {formatTime(duration)}
                    </span>
                </div>

                <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.2)' }} />

                <button onClick={stop} style={{ ...btnStyle, background: '#ff4757', color: '#fff' }}>
                    ⏹ 停止录制
                </button>
            </div>
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
        </div>
    );
};

export default RecordingPanel;
