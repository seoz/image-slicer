/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  Grid3X3, 
  Download, 
  Scissors, 
  RefreshCw, 
  Wand2, 
  ChevronRight, 
  ChevronLeft,
  X,
  Plus,
  Minus,
  Settings2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import { GoogleGenAI, Type } from "@google/genai";

// Initialization
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Using any to bypass environment-specific motion typing conflicts
const MotionDiv = motion.div as any;

interface SliceResult {
  id: string;
  url: string;
  blob: Blob;
  name: string;
}

interface EmoteBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

interface GridConfig {
  rows: number;
  cols: number;
  offsetTop: number;
  offsetBottom: number;
  offsetLeft: number;
  offsetRight: number;
  horizontalGap: number;
  verticalGap: number;
}

export default function App() {
  const [image, setImage] = useState<{ src: string; width: number; height: number } | null>(null);
  const [config, setConfig] = useState<GridConfig>({
    rows: 1,
    cols: 1,
    offsetTop: 0,
    offsetBottom: 0,
    offsetLeft: 0,
    offsetRight: 0,
    horizontalGap: 0,
    verticalGap: 0,
  });
  const [detectedBoxes, setDetectedBoxes] = useState<EmoteBox[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [useManualGrid, setUseManualGrid] = useState(true);
  const [dragState, setDragState] = useState<{
    index: number;
    handle?: string;
    startX: number;
    startY: number;
    initialBox: EmoteBox;
  } | null>(null);
  const [slices, setSlices] = useState<SliceResult[]>([]);
  const [isSlicing, setIsSlicing] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // File Upload
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          setImage({
            src: e.target?.result as string,
            width: img.width,
            height: img.height,
          });
          setSlices([]);
          setDetectedBoxes([]);
          setSelectedIndex(null);
          setUseManualGrid(true);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // @ts-ignore - Typing mismatch in environment for DropzoneOptions
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: false,
  });

  // AI Detection
  const handleAiDetect = async () => {
    if (!image) return;
    setIsDetecting(true);
    try {
      const base64Data = image.src.split(',')[1];
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: "image/png",
                data: base64Data,
              },
            },
            {
              text: `This image contains a grid or collection of emoticons. 
              Please detect EVERY individual emoticon or icon in the image.
              For each emoticon, identify its precise bounding box and a short, descriptive slug for a filename (e.g., "smile", "heart_eyes", "thumbs_up").
              If there is text associated with the icon in the image, use that text as the label.
              The coordinates should be in pixels relative to the image dimensions (Width: ${image.width}, Height: ${image.height}).
              Output ONLY a JSON array of objects, where each object has: x, y, width, height, and label.
              Be extremely precise so the images are cut perfectly without overlaps or missing parts.`,
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER, description: "X coordinate of top-left corner" },
                y: { type: Type.NUMBER, description: "Y coordinate of top-left corner" },
                width: { type: Type.NUMBER },
                height: { type: Type.NUMBER },
                label: { type: Type.STRING, description: "Descriptive name for the icon to use as filename" },
              },
              required: ["x", "y", "width", "height", "label"],
            }
          },
        },
      });

      const result = JSON.parse(response.text || '[]');
      if (Array.isArray(result) && result.length > 0) {
        setDetectedBoxes(result);
        setSelectedIndex(null);
        setUseManualGrid(false);
      }
    } catch (error) {
      console.error("AI Detection failed:", error);
    } finally {
      setIsDetecting(false);
    }
  };

  // Slicing Logic
  const performSlice = () => {
    if (!image || !imageRef.current) return;
    setIsSlicing(true);
    
    setTimeout(() => {
      const newSlices: SliceResult[] = [];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: true });

      if (!ctx) return;

      if (useManualGrid) {
        const { rows, cols, offsetTop, offsetBottom, offsetLeft, offsetRight, horizontalGap, verticalGap } = config;
        const workingWidth = image.width - offsetLeft - offsetRight;
        const workingHeight = image.height - offsetTop - offsetBottom;
        const cellWidth = (workingWidth - (cols - 1) * horizontalGap) / cols;
        const cellHeight = (workingHeight - (rows - 1) * verticalGap) / rows;

        canvas.width = cellWidth;
        canvas.height = cellHeight;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const sx = offsetLeft + c * (cellWidth + horizontalGap);
            const sy = offsetTop + r * (cellHeight + verticalGap);
            createSlice(ctx, canvas, sx, sy, cellWidth, cellHeight, `emote_${r}_${c}`, newSlices);
          }
        }
      } else {
        // Use AI Detected Boxes
        detectedBoxes.forEach((box, i) => {
          canvas.width = box.width;
          canvas.height = box.height;
          const fileName = box.label ? box.label.toLowerCase().trim().replace(/[\s\W]+/g, '_') : `emote_${i}`;
          createSlice(ctx, canvas, box.x, box.y, box.width, box.height, fileName, newSlices);
        });
      }

      setSlices(newSlices);
      setIsSlicing(false);
    }, 500);
  };

  const createSlice = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, fileName: string, target: SliceResult[]) => {
    if (!imageRef.current) return;
    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(
      imageRef.current,
      sx, sy, sw, sh,
      0, 0, sw, sh
    );

    const url = canvas.toDataURL('image/png');
    const base64 = url.split(',')[1];
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });

    target.push({
      id: Math.random().toString(36).substr(2, 9),
      url,
      blob,
      name: `${fileName}.png`
    });
  };

  const deleteBox = (index: number) => {
    setDetectedBoxes(prev => prev.filter((_, i) => i !== index));
  };

  const addBox = () => {
    if (!image) return;
    const size = Math.min(image.width, image.height) * 0.1;
    setDetectedBoxes(prev => [...prev, {
      x: (image.width - size) / 2,
      y: (image.height - size) / 2,
      width: size,
      height: size,
      label: `custom_${prev.length + 1}`
    }]);
    setUseManualGrid(false);
  };

  const handleBoxInteraction = (index: number, e: React.MouseEvent, handle?: string) => {
    e.stopPropagation();
    setSelectedIndex(index);
    setDragState({
      index,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      initialBox: { ...detectedBoxes[index] }
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedIndex === null || useManualGrid) return;
      
      // Don't interfere with typing if an input is focused
      if (document.activeElement?.tagName === 'INPUT') return;

      const step = e.shiftKey ? 10 : 1;
      const box = { ...detectedBoxes[selectedIndex] };
      let changed = false;

      if (e.key === 'ArrowUp') {
        if (e.altKey) box.height = Math.max(1, box.height - step);
        else box.y = Math.max(0, box.y - step);
        changed = true;
      } else if (e.key === 'ArrowDown') {
        if (e.altKey) box.height = box.height + step;
        else box.y = Math.min((image?.height || 0) - box.height, box.y + step);
        changed = true;
      } else if (e.key === 'ArrowLeft') {
        if (e.altKey) box.width = Math.max(1, box.width - step);
        else box.x = Math.max(0, box.x - step);
        changed = true;
      } else if (e.key === 'ArrowRight') {
        if (e.altKey) box.width = box.width + step;
        else box.x = Math.min((image?.width || 0) - box.width, box.x + step);
        changed = true;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteBox(selectedIndex);
        setSelectedIndex(null);
        return;
      } else if (e.key === 'Escape') {
        setSelectedIndex(null);
        return;
      }

      if (changed) {
        e.preventDefault();
        setDetectedBoxes(prev => {
          const next = [...prev];
          next[selectedIndex] = box;
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, detectedBoxes, useManualGrid, image]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState || !image) return;

      const dx = (e.clientX - dragState.startX) / previewScale;
      const dy = (e.clientY - dragState.startY) / previewScale;

      setDetectedBoxes(prev => {
        const next = [...prev];
        const box = { ...dragState.initialBox };

        if (!dragState.handle) {
          // Dragging
          box.x = Math.max(0, Math.min(image.width - box.width, box.x + dx));
          box.y = Math.max(0, Math.min(image.height - box.height, box.y + dy));
        } else {
          // Resizing
          const h = dragState.handle;
          if (h.includes('r')) box.width = Math.max(10, box.width + dx);
          if (h.includes('b')) box.height = Math.max(10, box.height + dy);
          if (h.includes('l')) {
            const newW = Math.max(10, box.width - dx);
            box.x = box.x + (box.width - newW);
            box.width = newW;
          }
          if (h.includes('t')) {
            const newH = Math.max(10, box.height - dy);
            box.y = box.y + (box.height - newH);
            box.height = newH;
          }
        }

        next[dragState.index] = box;
        return next;
      });
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    if (dragState) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, previewScale, image]);

  const downloadAll = async () => {
    const zip = new JSZip();
    slices.forEach((slice) => {
      zip.file(slice.name, slice.blob);
    });
    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'emotes_pack.zip';
    link.click();
  };

  // Adjust preview scale to fit container (both width and height)
  const fitToViewport = useCallback(() => {
    if (image && containerRef.current) {
      const containerWidth = containerRef.current.clientWidth - 120;
      const containerHeight = containerRef.current.clientHeight - 120;
      
      const scaleW = containerWidth / image.width;
      const scaleH = containerHeight / image.height;
      
      const scale = Math.min(1, scaleW, scaleH);
      setPreviewScale(scale);
    }
  }, [image]);

  useEffect(() => {
    fitToViewport();
    window.addEventListener('resize', fitToViewport);
    return () => window.removeEventListener('resize', fitToViewport);
  }, [fitToViewport]);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="px-8 py-6 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#050505]/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-600 rounded-lg flex items-center justify-center shadow-lg shadow-orange-900/20">
            <Scissors className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tighter bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Image Slicer</h1>
            <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Smart Image Slicing</p>
          </div>
        </div>
        
        {image && (
          <div className="flex items-center gap-4">
            <button 
              onClick={() => { setImage(null); setSlices([]); }}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
              Reset
            </button>
            <button 
              onClick={performSlice}
              disabled={isSlicing}
              className="px-6 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 rounded-full font-semibold text-sm flex items-center gap-2 shadow-lg shadow-orange-900/20"
            >
              <Scissors className={`w-4 h-4 ${isSlicing ? 'animate-spin' : ''}`} />
              {isSlicing ? 'Slicing...' : 'Slice Image'}
            </button>
          </div>
        )}
      </header>

      <main className="flex h-[calc(100vh-88px)] overflow-hidden">
        {/* Left Sidebar - Controls */}
        <aside className="w-80 border-r border-white/10 p-6 overflow-y-auto bg-[#080808]/50 custom-scrollbar flex flex-col">
          {!image ? (
            <div className="h-full flex flex-col justify-center text-center opacity-50 space-y-4">
              <Upload className="w-12 h-12 mx-auto" />
              <p className="text-sm">Upload an image to start configuration</p>
            </div>
          ) : (
            <div className="space-y-8">
              <div>
                <button 
                  onClick={handleAiDetect}
                  disabled={isDetecting}
                  className={`w-full flex items-center justify-center gap-3 px-4 py-4 rounded-xl border transition-all text-sm font-medium group ${!useManualGrid && detectedBoxes.length > 0 ? 'border-orange-500 bg-orange-500/10' : 'border-white/20 hover:border-orange-500/50 hover:bg-orange-500/5'}`}
                >
                  <Wand2 className={`w-5 h-5 text-orange-500 ${isDetecting ? 'animate-pulse' : 'group-hover:scale-110 transition-transform'}`} />
                  {isDetecting ? 'AI Analyzing...' : !useManualGrid && detectedBoxes.length > 0 ? 'AI Boost Active' : 'Magic Auto-Detect'}
                </button>
                <div className="space-y-2 mt-2">
                  {!useManualGrid && (
                    <button 
                      onClick={() => { setUseManualGrid(true); setSelectedIndex(null); }}
                      className="w-full text-[10px] uppercase tracking-widest text-white/40 hover:text-white transition-colors text-center"
                    >
                      Switch back to manual grid
                    </button>
                  )}
                  {useManualGrid && (
                    <button 
                      onClick={() => { setUseManualGrid(false); if (detectedBoxes.length === 0) addBox(); }}
                      className="w-full text-[10px] uppercase tracking-widest text-white/40 hover:text-white transition-colors text-center"
                    >
                      Switch to custom boxes
                    </button>
                  )}
                  {!useManualGrid && (
                    <button 
                      onClick={addBox}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-white/10 hover:border-orange-500/50 hover:bg-orange-500/5 transition-all text-xs font-medium"
                    >
                      <Plus className="w-4 h-4 text-orange-500" />
                      Add Manual Area
                    </button>
                  )}
                </div>
              </div>

              <div className={`space-y-6 transition-opacity ${!useManualGrid ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                  <Grid3X3 className="w-4 h-4 text-orange-500" />
                  <h2 className="text-sm font-semibold uppercase tracking-widest text-white/60">Grid Setting</h2>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <ConfigInput 
                    label="Rows" 
                    value={config.rows} 
                    onChange={val => setConfig(prev => ({ ...prev, rows: Math.max(1, parseInt(val) || 1) }))} 
                  />
                  <ConfigInput 
                    label="Columns" 
                    value={config.cols} 
                    onChange={val => setConfig(prev => ({ ...prev, cols: Math.max(1, parseInt(val) || 1) }))} 
                  />
                </div>

                <div className="space-y-6">
                  <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                    <Settings2 className="w-4 h-4 text-orange-500" />
                    <h2 className="text-sm font-semibold uppercase tracking-widest text-white/60">Precise Offsets</h2>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <ConfigInput label="Top" value={config.offsetTop} onChange={val => setConfig(prev => ({ ...prev, offsetTop: parseInt(val) || 0 }))} />
                    <ConfigInput label="Bottom" value={config.offsetBottom} onChange={val => setConfig(prev => ({ ...prev, offsetBottom: parseInt(val) || 0 }))} />
                    <ConfigInput label="Left" value={config.offsetLeft} onChange={val => setConfig(prev => ({ ...prev, offsetLeft: parseInt(val) || 0 }))} />
                    <ConfigInput label="Right" value={config.offsetRight} onChange={val => setConfig(prev => ({ ...prev, offsetRight: parseInt(val) || 0 }))} />
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                    <Scissors className="w-4 h-4 text-orange-500" />
                    <h2 className="text-sm font-semibold uppercase tracking-widest text-white/60">Item Gaps</h2>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <ConfigInput label="H-Gap" value={config.horizontalGap} onChange={val => setConfig(prev => ({ ...prev, horizontalGap: parseInt(val) || 0 }))} />
                    <ConfigInput label="V-Gap" value={config.verticalGap} onChange={val => setConfig(prev => ({ ...prev, verticalGap: parseInt(val) || 0 }))} />
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div className="mt-auto pt-8 pb-2 text-center">
            <p className="text-[10px] text-white/20 uppercase tracking-[0.2em] font-medium">
              made by <span className="text-white/40">Daniel Seo</span>
            </p>
          </div>
        </aside>

        {/* Center - Preview */}
        <section 
          className="flex-1 bg-[#050505] overflow-auto relative" 
          ref={containerRef}
          onClick={() => setSelectedIndex(null)}
        >
          <div className="min-h-full flex min-w-full p-12">
            <AnimatePresence mode="wait">
              {!image ? (
                <MotionDiv 
                  key="upload-zone"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  {...getRootProps()}
                  className={`m-auto w-full max-w-2xl h-96 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-12 transition-all cursor-pointer bg-white/5 ${isDragActive ? 'border-orange-500 bg-orange-500/5' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.07]'}`}
                >
                <input {...getInputProps()} />
                <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mb-6">
                  <Upload className="w-8 h-8 text-white/60" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Drop your emoticon sheet here</h3>
                <p className="text-white/40 text-sm max-w-sm text-center">Supports PNG, JPG, and WebP. Works best with high-resolution sheets.</p>
              </MotionDiv>
            ) : (
              <div 
                className="m-auto relative"
                style={{ 
                  width: image.width * previewScale, 
                  height: image.height * previewScale,
                  transition: 'width 0.2s, height 0.2s',
                  flexShrink: 0
                }}
              >
                  <MotionDiv 
                    key="preview-zone"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: previewScale }}
                    className="absolute top-0 left-0"
                    style={{ 
                      width: image.width,
                      height: image.height,
                      transformOrigin: 'top left' 
                    }}
                  >
                    <img 
                      ref={imageRef}
                      src={image.src} 
                      alt="Original" 
                      className="rounded shadow-2xl block border border-white/5"
                    />
                    
                    {/* Grid Overlay */}
                    {useManualGrid ? (
                      <div 
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          top: `${config.offsetTop}px`,
                          bottom: `${config.offsetBottom}px`,
                          left: `${config.offsetLeft}px`,
                          right: `${config.offsetRight}px`,
                        }}
                      >
                        <div 
                          className="grid w-full h-full"
                          style={{
                            gridTemplateRows: `repeat(${config.rows}, 1fr)`,
                            gridTemplateColumns: `repeat(${config.cols}, 1fr)`,
                            gap: `${config.verticalGap}px ${config.horizontalGap}px`
                          }}
                        >
                          {Array.from({ length: config.rows * config.cols }).map((_, i) => (
                            <div 
                              key={i} 
                              className="border border-orange-500/40 bg-orange-500/10 transition-colors animate-pulse"
                              style={{ animationDelay: `${i * 0.05}s` }}
                            ></div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="absolute inset-0">
                        {detectedBoxes.map((box, i) => (
                          <div 
                            key={i}
                            onMouseDown={(e) => handleBoxInteraction(i, e)}
                            onClick={(e) => e.stopPropagation()}
                            className={`absolute border transition-all flex items-center justify-center group pointer-events-auto cursor-move ${selectedIndex === i ? 'border-orange-500 ring-2 ring-orange-500/20 bg-orange-500/20 z-10' : 'border-cyan-400/60 bg-cyan-400/10 hover:border-orange-500/60 hover:bg-orange-500/10'}`}
                            style={{
                              left: `${box.x}px`,
                              top: `${box.y}px`,
                              width: `${box.width}px`,
                              height: `${box.height}px`,
                              animationDelay: !dragState ? `${i * 0.05}s` : '0s'
                            }}
                          >
                            <div className="flex flex-col items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none select-none">
                              <span className="text-[10px] font-mono text-cyan-300 font-bold whitespace-nowrap bg-black/40 px-1 rounded">{box.label || i+1}</span>
                            </div>
                            
                            {/* Delete Button */}
                            <button 
                              onClick={(e) => { e.stopPropagation(); deleteBox(i); setSelectedIndex(null); }}
                              className={`absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center transition-opacity z-20 ${selectedIndex === i ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                            >
                              <X className="w-3 h-3" />
                            </button>

                            {/* Handles */}
                            {['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'].map(h => (
                              <div 
                                key={h}
                                onMouseDown={(e) => handleBoxInteraction(i, e, h)}
                                onClick={(e) => e.stopPropagation()}
                                className={`absolute w-2 h-2 bg-white border border-orange-500 rounded-full transition-opacity ${selectedIndex === i ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${
                                  h === 'tl' ? '-top-1 -left-1 cursor-nw-resize' :
                                  h === 'tr' ? '-top-1 -right-1 cursor-ne-resize' :
                                  h === 'bl' ? '-bottom-1 -left-1 cursor-sw-resize' :
                                  h === 'br' ? '-bottom-1 -right-1 cursor-se-resize' :
                                  h === 't' ? '-top-1 left-1/2 -translate-x-1/2 w-4 h-1 cursor-n-resize rounded-none' :
                                  h === 'b' ? '-bottom-1 left-1/2 -translate-x-1/2 w-4 h-1 cursor-s-resize rounded-none' :
                                  h === 'l' ? 'top-1/2 -left-1 -translate-y-1/2 h-4 w-1 cursor-w-resize rounded-none' :
                                  h === 'r' ? 'top-1/2 -right-1 -translate-y-1/2 h-4 w-1 cursor-e-resize rounded-none' : ''
                                }`}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </MotionDiv>
                </div>
            )}
          </AnimatePresence>
        </div>
          
          {image && (
            <MotionDiv 
              drag
              dragMomentum={false}
              dragConstraints={containerRef}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-[#121212] border border-white/10 rounded-full px-6 py-2 flex items-center gap-6 shadow-2xl shadow-black/80 z-[100] cursor-grab active:cursor-grabbing"
            >
              <div className="flex items-center gap-2 text-xs font-mono text-white/60 select-none">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                {image.width} × {image.height} px
              </div>
              <div className="w-px h-3 bg-white/20"></div>
              <div className="flex items-center gap-3">
                <button 
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setPreviewScale(s => Math.max(0.1, s - 0.1))} 
                  className="p-1 hover:text-orange-500 hover:bg-white/5 rounded-md transition-all"
                >
                  <Minus className="w-4 h-4"/>
                </button>
                <span className="text-xs font-mono w-12 text-center select-none">{Math.round(previewScale * 100)}%</span>
                <button 
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setPreviewScale(s => Math.min(5, s + 0.1))} 
                  className="p-1 hover:text-orange-500 hover:bg-white/5 rounded-md transition-all"
                >
                  <Plus className="w-4 h-4"/>
                </button>
              </div>
              <div className="w-px h-3 bg-white/20"></div>
              <button 
                onPointerDown={(e) => e.stopPropagation()}
                onClick={fitToViewport}
                className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/60 hover:text-orange-500 transition-colors font-bold"
              >
                <RefreshCw className="w-3 h-3" />
                Fit
              </button>
            </MotionDiv>
          )}
        </section>

        {/* Right Sidebar - Results */}
        <AnimatePresence>
          {slices.length > 0 && (
            <MotionDiv 
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              className="w-96 border-l border-white/10 p-6 overflow-hidden flex flex-col bg-[#080808]/80 backdrop-blur-xl"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-lg font-bold">Results</h2>
                  <p className="text-xs text-white/40 uppercase tracking-widest">{slices.length} items extracted</p>
                </div>
                <button 
                  onClick={downloadAll}
                  className="p-3 bg-white text-black hover:bg-orange-500 hover:text-white transition-all rounded-xl"
                  title="Download All as ZIP"
                >
                  <Download className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                <div className="grid grid-cols-3 gap-3">
                  {slices.map((slice, idx) => (
                    <MotionDiv 
                      key={slice.id}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.01 }}
                      className="group relative aspect-square bg-white/5 rounded-xl flex items-center justify-center p-2 hover:bg-white/10 transition-all border border-white/5"
                    >
                      <img src={slice.url} alt={`slice-${idx}`} className="max-w-full max-h-full object-contain" />
                      <a 
                        href={slice.url} 
                        download={slice.name}
                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 transition-opacity rounded-xl"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </MotionDiv>
                  ))}
                </div>
              </div>
            </MotionDiv>
          )}
        </AnimatePresence>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}

function ConfigInput({ label, value, onChange }: { label: string; value: number; onChange: (val: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-tighter text-white/40 font-bold">{label}</label>
      <input 
        type="number" 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 focus:bg-white/10 transition-all text-center"
      />
    </div>
  );
}
