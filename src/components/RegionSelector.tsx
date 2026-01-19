import React, { useState, useRef, useEffect, useCallback } from 'react';

interface SelectionRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface RegionSelectorProps {
    mode: 'clipboard' | 'file' | 'record';
    onCancel: () => void;
    onStartRecording?: (rect: SelectionRect) => void;
}

export const RegionSelector: React.FC<RegionSelectorProps> = ({
    mode,
    onCancel,
    onStartRecording
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });
    const [selection, setSelection] = useState<SelectionRect | null>(null);
    // 新增状态：标记是否已经点击了开始录制
    const [isRecordingActive, setIsRecordingActive] = useState(false);

    // 选区边框颜色 - 使用更现代的青色
    const selectionColor = '#00d4ff';

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
        }
    }, []);

    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (selection && selection.width > 0 && selection.height > 0) {
            ctx.clearRect(selection.x, selection.y, selection.width, selection.height);

            // 青色边框
            ctx.strokeStyle = selectionColor;
            ctx.lineWidth = 2;
            ctx.strokeRect(selection.x, selection.y, selection.width, selection.height);

            // 四角
            const cs = 8;
            ctx.fillStyle = selectionColor;
            ctx.fillRect(selection.x - cs / 2, selection.y - cs / 2, cs, cs);
            ctx.fillRect(selection.x + selection.width - cs / 2, selection.y - cs / 2, cs, cs);
            ctx.fillRect(selection.x - cs / 2, selection.y + selection.height - cs / 2, cs, cs);
            ctx.fillRect(selection.x + selection.width - cs / 2, selection.y + selection.height - cs / 2, cs, cs);

            // 尺寸标签 - 毛玻璃风格
            const label = `${selection.width} × ${selection.height}`;
            ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
            const labelWidth = ctx.measureText(label).width + 16;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(selection.x, selection.y - 24, labelWidth, 22);
            ctx.fillStyle = 'rgba(220, 220, 220, 0.95)';
            ctx.fillText(label, selection.x + 8, selection.y - 8);
        }
    }, [selection, selectionColor]);

    useEffect(() => {
        drawCanvas();
    }, [selection, drawCanvas]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [onCancel]);

    const captureAndFinish = useCallback(async (rect: SelectionRect, mouseStartPos: { x: number, y: number }) => {
        if (rect.width < 5 || rect.height < 5) return;

        try {
            await window.electronAPI.captureRegion(rect, mode, mouseStartPos);
        } catch (e) {
            console.error('Capture error:', e);
        }
    }, [mode]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        setIsSelecting(true);
        setStartPoint({ x: e.clientX, y: e.clientY });
        setSelection(null);
    };

    // 使用 useEffect 添加全局监听器，确保拖拽出窗口也能响应
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isSelecting) return;
            const rect: SelectionRect = {
                x: Math.min(startPoint.x, e.clientX),
                y: Math.min(startPoint.y, e.clientY),
                width: Math.abs(e.clientX - startPoint.x),
                height: Math.abs(e.clientY - startPoint.y)
            };
            setSelection(rect);
        };

        const handleMouseUp = (e: MouseEvent) => {
            if (e.button !== 0 || !isSelecting) return;
            setIsSelecting(false);

            if (selection && selection.width > 5 && selection.height > 5) {
                if (mode === 'record') {
                    // 录屏模式等待点击按钮
                } else {
                    captureAndFinish(selection, startPoint);
                }
            }
        };

        if (isSelecting) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isSelecting, startPoint, selection, mode, captureAndFinish]);

    // 点击穿透逻辑
    useEffect(() => {
        // 只有当真正开始录制后 (isRecordingActive 为 true)，才开启穿透
        if (mode === 'record' && isRecordingActive) {
            window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
        } else {
            // F3 选区阶段、F1/F2 截图阶段、或者录制停止后：必须捕获鼠标
            window.electronAPI.setIgnoreMouseEvents(false);
        }

        return () => {
            window.electronAPI.setIgnoreMouseEvents(false);
        };
    }, [mode, isRecordingActive]); // 依赖 isRecordingActive

    // 重置状态
    useEffect(() => {
        if (mode !== 'record') {
            setIsRecordingActive(false);
        }
    }, [mode]);

    const handleControlMouseEnter = () => {
        if (mode === 'record' && isRecordingActive) {
            // 鼠标移入控制条：取消忽略，恢复点击能力
            window.electronAPI.setIgnoreMouseEvents(false);
        }
    };

    const handleControlMouseLeave = () => {
        if (mode === 'record' && isRecordingActive) {
            // 鼠标移出控制条：恢复穿透
            window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
        }
    };

    const handleStartRecording = useCallback(() => {
        if (!selection || !onStartRecording) return;
        setIsRecordingActive(true); // 激活穿透状态
        onStartRecording(selection);
    }, [selection, onStartRecording]);

    // 按钮样式
    const btnStyle: React.CSSProperties = {
        padding: '10px 20px',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'all 0.2s ease'
    };

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                cursor: 'crosshair',
                overflow: 'hidden',
                zIndex: 99999,
                background: 'transparent',
                // CRITICAL FIX: Disable pointer events on the container during recording
                // This allows the 'forward: true' in main process to verify that we hit "nothing"
                // and correctly pass clicks through to the desktop.
                pointerEvents: (mode === 'record' && isRecordingActive) ? 'none' : 'auto'
            }}
            onMouseDown={handleMouseDown}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none'
                }}
            />

            {/* 录屏模式按钮 */}
            {mode === 'record' && selection && !isSelecting && selection.width > 20 && selection.height > 20 && (
                <div
                    style={{
                        position: 'absolute',
                        left: selection.x,
                        // 智能定位：如果底部空间不够（例如全屏），就显示在选区内部的底部
                        top: (selection.y + selection.height + 60 > window.innerHeight)
                            ? selection.y + selection.height - 60
                            : selection.y + selection.height + 12,
                        display: 'flex',
                        gap: '10px',
                        background: 'rgba(20, 20, 20, 0.85)',
                        backdropFilter: 'blur(12px)',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        zIndex: 100000,
                        pointerEvents: 'auto', // Ensure the control bar itself is clickable
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                    onMouseEnter={handleControlMouseEnter}
                    onMouseLeave={handleControlMouseLeave}
                >
                    <button
                        onClick={handleStartRecording}
                        style={{
                            ...btnStyle,
                            background: 'linear-gradient(135deg, #ff4757 0%, #ff3f34 100%)',
                            color: '#fff',
                            boxShadow: '0 4px 12px rgba(255, 71, 87, 0.4)'
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="12" r="8" />
                        </svg>
                        开始录制
                    </button>
                    <button
                        onClick={onCancel}
                        style={{
                            ...btnStyle,
                            background: 'rgba(80, 80, 80, 0.8)',
                            color: 'rgba(220, 220, 220, 0.9)'
                        }}
                    >
                        取消
                    </button>
                </div>
            )}

            {!selection && (
                <div
                    style={{
                        position: 'fixed',
                        top: '20px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(0, 0, 0, 0.75)',
                        backdropFilter: 'blur(12px)',
                        color: 'rgba(220, 220, 220, 0.95)',
                        padding: '12px 24px',
                        borderRadius: '10px',
                        fontSize: '14px',
                        zIndex: 100000,
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        pointerEvents: 'none'
                    }}
                >
                    拖拽选择区域 | 松开自动{mode === 'clipboard' ? '复制' : mode === 'file' ? '保存' : '确认'} | ESC/右键取消
                </div>
            )}
        </div>
    );
};

export default RegionSelector;
