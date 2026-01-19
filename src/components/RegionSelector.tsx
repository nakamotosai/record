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
    // 屏幕冻结模式：静态截图背景 (F1/F2)
    const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

    // 选区边框颜色 - 使用更现代的青色
    const selectionColor = '#00d4ff';

    // 监听来自主进程的截图数据（F1/F2 冻结模式）
    useEffect(() => {
        window.electronAPI.onInitScreenshot((buffer: Uint8Array) => {
            console.log('[RegionSelector] Received screenshot buffer, size:', buffer.byteLength);

            // 收到的是 Uint8Array (Buffer)，创建 Blob URL
            const blob = new Blob([buffer as any], { type: 'image/png' });
            const url = URL.createObjectURL(blob);

            console.log('[RegionSelector] Created Blob URL:', url);

            // 预加载图片确保渲染前已在内存中
            const img = new Image();
            img.onload = () => {
                console.log('[RegionSelector] Screenshot preloaded, setting state');
                setScreenshotUrl(url);
                // 通知主进程可以显示窗口了
                window.electronAPI.screenshotReady();
            };
            img.src = url;
        });

        // 监听清除截图事件（窗口重用时）
        window.electronAPI.onClearScreenshot(() => {
            console.log('[RegionSelector] Clearing screenshot for window reuse');
            setScreenshotUrl(prevUrl => {
                if (prevUrl) URL.revokeObjectURL(prevUrl); // 释放内存
                return null;
            });
            setSelection(null);
        });

        return () => {
            // 组件卸载时清理（虽然这个组件通常常驻）
            setScreenshotUrl(prevUrl => {
                if (prevUrl) URL.revokeObjectURL(prevUrl);
                return null;
            });
        };
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            // 只有录屏模式才默认绘制蒙版 (F1/F2 需要等待 screenshotUrl)
            // 如果是 F1/F2 且没有 screenshotUrl，则保持全透明 (idle state)
            if (mode === 'record') {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            }
        }
    }, [screenshotUrl, mode]);



    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 只有录屏模式才默认绘制蒙版
        if (mode === 'record') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        // F1/F2: 如果有 screenshotUrl，由 img 标签负责背景，canvas 只负责选区
        // 如果没有 screenshotUrl，则是 idle 状态，全透明

        if (selection && selection.width > 0 && selection.height > 0) {
            // 清除选区（让底层内容显示）
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
    }, [selection, selectionColor, screenshotUrl]);

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

    // 注：移除了 document.body.cursor 设置，因为它会与元素级 cursor 冲突导致闪烁
    // 光标样式完全由元素的 CSS cursor 属性控制

    // 点击穿透逻辑
    useEffect(() => {
        // 只有当真正开始录制后 (isRecordingActive 为 true)，才开启穿透
        if (mode === 'record') {
            if (isRecordingActive) {
                window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
            } else {
                window.electronAPI.setIgnoreMouseEvents(false);
            }
        } else {
            // F1/F2 模式
            if (screenshotUrl) {
                // 有截图了，说明激活了，必须捕获鼠标
                window.electronAPI.setIgnoreMouseEvents(false);
            } else {
                // 没有截图，说明是预热/空闲状态，必须穿透且不转发！！
                window.electronAPI.setIgnoreMouseEvents(true, { forward: false });
            }
        }

        return () => {
            // 清理时，如果是 F1/F2 且被销毁，主进程会处理销毁。
        };
    }, [mode, isRecordingActive, screenshotUrl]); // 关键：依赖 screenshotUrl

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
                zIndex: 2147483647,

                // 1. 背景色与透明度控制
                // Fix: 使用极低不透明度的背景代替完全透明，确保鼠标捕获稳定，防止光标闪烁
                // 0.02 alpha 既不可见又能保证 Windows 认为这是个实体窗口，不会穿透
                // 使用 background-image 方案时，背景色作为底色
                background: (mode !== 'record' && !screenshotUrl) || (mode === 'record' && isRecordingActive) ? 'transparent' : 'rgba(0, 0, 0, 0.02)',

                // 2. 截图图层处理
                // 已移除 backgroundImage，改用 img 标签以支持高 DPI 和 pointer-events 控制

                // 3. 鼠标交互控制
                // 只有在空闲状态 (F1/F2 且无截图) 下，pointerEvents 设为 none，确保 forward 生效
                pointerEvents: (mode !== 'record' && !screenshotUrl) || (mode === 'record' && isRecordingActive) ? 'none' : 'auto',

                // 4. 禁止文本选择
                // Fix: 禁止文本选择，防止拖拽时光标变成文本选择符 (I-beam) 或导致闪烁
                userSelect: 'none',
                WebkitUserSelect: 'none'
            }}
            onMouseDown={handleMouseDown}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
            }}
        >
            {/* 注入全局样式，确保光标样式无死角覆盖，防止 hit-test 失败时回退到默认光标 */}
            {(mode === 'record' && !isRecordingActive) || (mode !== 'record' && screenshotUrl) ? (
                <style>{`
                    html, body, #root {
                        cursor: crosshair !important;
                    }
                    * {
                        cursor: inherit;
                    }
                `}</style>
            ) : null}

            {/* 冻结模式：恢复使用 img 标签显示高清截图 (解决分辨率变大问题) */}
            {screenshotUrl && (
                <img
                    src={screenshotUrl}
                    alt=""
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'fill', // 强制填满窗口，避免任何缩放偏差
                        // 修正：让图片作为实体层响应鼠标，这是最稳定的方案
                        pointerEvents: 'auto',
                        cursor: 'crosshair',
                        // 优化高分辨率图像渲染质量
                        imageRendering: 'high-quality' as any
                    }}
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                />
            )}

            {/* 已移除 backgroundImage，改回 img 标签 */}
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

            {/* 仅在非空闲状态显示提示文字 */}
            {!selection && (mode === 'record' || screenshotUrl) && (
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
