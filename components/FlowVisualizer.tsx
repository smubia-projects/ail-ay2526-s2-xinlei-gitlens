import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { DependencyGraphData, DependencyNode, UsageExample } from '../types';
import { X, ExternalLink, Code2, FileCode, Info, ArrowRight, Network, GitBranch } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FlowVisualizerProps {
  data: DependencyGraphData;
  onClose: () => void;
  onNavigate: (path: string, line?: number) => void;
}

export const FlowVisualizer: React.FC<FlowVisualizerProps> = React.memo(({ data, onClose, onNavigate }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [sidebarTab, setSidebarTab] = useState<'usages' | 'trace'>('usages');
  const lastDataRef = useRef<DependencyGraphData | null>(null);

  useEffect(() => {
    if (data.call_flow_markdown && !data.usage_examples?.length) {
      setSidebarTab('trace');
    }
  }, [data]);

  useEffect(() => {
    if (!svgRef.current || data.nodes.length === 0) return;
    
    // Prevent re-rendering if data hasn't changed
    if (lastDataRef.current === data) return;
    lastDataRef.current = data;

    const renderFlow = () => {
      if (!svgRef.current) return;
      const width = svgRef.current.clientWidth;
      const height = svgRef.current.clientHeight;

      if (width === 0 || height === 0) return;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();

      const g = svg.append("g");

      // Define arrow markers
      svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "-0 -5 10 10")
        .attr("refX", 10) 
        .attr("refY", 0)
        .attr("orient", "auto")
        .attr("markerWidth", 8)
        .attr("markerHeight", 8)
        .attr("xoverflow", "visible")
        .append("svg:path")
        .attr("d", "M 0,-5 L 10 ,0 L 0,5")
        .attr("fill", "#ffffff")
        .style("stroke", "none");

      const simulation = d3.forceSimulation(data.nodes as any)
        .force("link", d3.forceLink(data.links).id((d: any) => d.id).distance(220))
        .force("charge", d3.forceManyBody().strength(-800))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(100));

      // Run simulation to completion immediately
      for (let i = 0; i < 300; ++i) simulation.tick();

      const nodeWidth = 200;
      const nodeHeight = 50;

      const getIntersection = (source: any, target: any) => {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const halfW = nodeWidth / 2;
        const halfH = nodeHeight / 2;

        if (dx === 0 && dy === 0) return { x: target.x, y: target.y };

        const slope = dy / dx;
        const rectSlope = halfH / halfW;

        if (Math.abs(slope) <= rectSlope) {
          // Intersects with left or right side
          const x = dx > 0 ? target.x - halfW : target.x + halfW;
          const y = target.y - (dx > 0 ? halfW * slope : -halfW * slope);
          return { x, y };
        } else {
          // Intersects with top or bottom side
          const y = dy > 0 ? target.y - halfH : target.y + halfH;
          const x = target.x - (dy > 0 ? halfH / slope : -halfH / slope);
          return { x, y };
        }
      };

      const link = g.append("g")
        .selectAll("line")
        .data(data.links)
        .enter()
        .append("line")
        .attr("stroke", "rgba(255, 255, 255, 0.15)")
        .attr("stroke-width", 1.5)
        .attr("marker-end", "url(#arrowhead)")
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => getIntersection(d.source, d.target).x)
        .attr("y2", (d: any) => getIntersection(d.source, d.target).y);

      const node = g.append("g")
        .selectAll("g")
        .data(data.nodes)
        .enter()
        .append("g")
        .attr("class", "cursor-pointer")
        .attr("transform", (d: any) => `translate(${d.x},${d.y})`)
        .on("click", (event, d: any) => {
          onNavigate(d.file, d.line);
        })
        .call(d3.drag<SVGGElement, any>()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended) as any);

      node.append("rect")
        .attr("width", nodeWidth)
        .attr("height", nodeHeight)
        .attr("x", -nodeWidth / 2)
        .attr("y", -nodeHeight / 2)
        .attr("rx", 14)
        .attr("fill", d => d.type === 'file' ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 255, 255, 0.12)")
        .attr("stroke", d => d.type === 'file' ? "rgba(255, 255, 255, 0.15)" : "rgba(255, 255, 255, 0.3)")
        .attr("stroke-width", 1.5)
        .style("backdrop-filter", "blur(12px)")
        .attr("class", "transition-all duration-300 hover:fill-white/20 hover:stroke-white/50");

      // Add tooltip
      node.append("title")
        .text(d => `${d.label}\nFile: ${d.file}${d.line ? ` (Line ${d.line})` : ''}`);

      node.append("text")
        .attr("dy", "-2")
        .attr("text-anchor", "middle")
        .style("fill", "#fff")
        .style("font-size", "12px")
        .style("font-weight", "700")
        .style("pointer-events", "none")
        .text(d => d.label.length > 28 ? d.label.substring(0, 25) + "..." : d.label);

      node.append("text")
        .attr("dy", "16")
        .attr("text-anchor", "middle")
        .style("fill", "rgba(255, 255, 255, 0.5)")
        .style("font-size", "10px")
        .style("font-weight", "500")
        .style("pointer-events", "none")
        .text(d => {
          const parts = (d.file || '').split('/');
          return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : d.file;
        });

      function dragstarted(event: any) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      }

      function dragged(event: any) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      }

      function dragended(event: any) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }

      const zoom = d3.zoom()
        .scaleExtent([0.1, 5])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        });

      svg.call(zoom as any);
      
      const initialScale = 0.8;
      svg.call(zoom.transform as any, d3.zoomIdentity.translate(width/2, height/2).scale(initialScale).translate(-width/2, -height/2));
    };

    const resizeObserver = new ResizeObserver(() => {
      renderFlow();
    });

    resizeObserver.observe(svgRef.current);
    renderFlow();

    return () => resizeObserver.disconnect();
  }, [data, onNavigate]);


  const hasSidebar = (data.usage_examples && data.usage_examples.length > 0) || data.call_flow_markdown;

  return (
    <div className="absolute inset-0 bg-black/90 backdrop-blur-xl z-[100] flex flex-col animate-in fade-in duration-300">
      <div className="h-14 border-b border-white/10 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-lg text-white">
            <Code2 size={18} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-white uppercase tracking-widest">Logic Flow Visualizer</span>
            <span className="text-[10px] text-neutral-500 font-mono">Tracing cross-file dependencies and call hierarchy</span>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white"
        >
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 flex relative overflow-hidden">
        <div className="flex-1 relative">
          <svg ref={svgRef} className="w-full h-full" />
          <div className="absolute bottom-6 left-6 flex flex-col gap-2 pointer-events-none">
            <div className="bg-neutral-900/80 border border-white/10 p-4 rounded-2xl backdrop-blur-md shadow-2xl">
              <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-3">Legend</div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-white/20 border border-white/50" />
                  <span className="text-[10px] text-neutral-300">Function / Symbol</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-neutral-800 border border-white/10" />
                  <span className="text-[10px] text-neutral-300">File Reference</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-[1px] bg-white/30" />
                  <span className="text-[10px] text-neutral-300">Call / Dependency</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {hasSidebar && (
          <aside className="w-96 border-l border-white/10 bg-neutral-900/50 backdrop-blur-md flex flex-col overflow-hidden animate-in slide-in-from-right duration-500">
            <div className="border-b border-white/10 bg-neutral-950/50 p-2 flex gap-1">
              <button 
                onClick={() => setSidebarTab('usages')}
                className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${sidebarTab === 'usages' ? 'bg-white text-black shadow-lg shadow-white/20' : 'text-neutral-500 hover:bg-white/10'}`}
              >
                <Info size={14} /> Usages
              </button>
              <button 
                onClick={() => setSidebarTab('trace')}
                className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${sidebarTab === 'trace' ? 'bg-white text-black shadow-lg shadow-white/20' : 'text-neutral-500 hover:bg-white/10'}`}
              >
                <GitBranch size={14} /> Trace Map
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {sidebarTab === 'usages' ? (
                <div className="space-y-4">
                  {data.usage_examples && data.usage_examples.length > 0 ? (
                    data.usage_examples.map((ex, i) => (
                      <div 
                        key={i}
                        onClick={() => onNavigate(ex.file, ex.line)}
                        className="bg-neutral-950/80 border border-white/10 p-4 rounded-2xl hover:border-white/50 transition-all cursor-pointer group"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 text-white">
                            <FileCode size={14} />
                            <span className="text-[11px] font-bold mono truncate max-w-[150px]">{(ex.file || '').split('/').pop()}</span>
                          </div>
                          <span className="text-[10px] mono text-neutral-600 font-bold">L{ex.line}</span>
                        </div>
                        
                        <div className="space-y-3">
                          <div className="bg-white/5 border border-white/10 p-2.5 rounded-xl">
                            <div className="text-[9px] uppercase font-bold text-white/70 mb-1">Invoked with</div>
                            <div className="text-[11px] mono text-neutral-300 break-all bg-neutral-900/50 p-2 rounded-lg border border-white/10">
                              {ex.arguments}
                            </div>
                          </div>
                          <p className="text-[11px] text-neutral-400 leading-relaxed italic">
                            {ex.context_explanation}
                          </p>
                        </div>
                        
                        <div className="mt-3 flex items-center justify-end text-[9px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
                          View in file <ArrowRight size={10} className="ml-1" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="h-64 flex flex-col items-center justify-center text-neutral-700 gap-4 opacity-50">
                      <Info size={48} />
                      <p className="text-xs font-medium">No usage examples found</p>
                    </div>
                  )}
                </div>
              ) : (
    <div className="animate-in fade-in duration-300">
      {data.call_flow_markdown ? (
        <div className="bg-neutral-950/80 border border-white/10 p-6 rounded-2xl overflow-hidden shadow-inner">
          <div className="text-[12px] text-white uppercase font-black mb-6 flex items-center gap-2 tracking-[0.2em] border-b border-white/20 pb-3">
            <Network size={16} className="text-white" /> Call Hierarchy & Logic Trace
          </div>
          <div className="text-[12px] leading-relaxed pl-3 border-l border-white/30 overflow-x-auto">
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              components={{
                p({ children }) {
                  const content = React.Children.toArray(children).join('');
                  const isMermaid = content.trim().startsWith('graph TD') || content.trim().startsWith('flowchart');
                  
                  if (isMermaid) {
                    return (
                      <div className="my-4 p-3 bg-white/5 border border-dashed border-white/20 rounded-xl relative overflow-x-auto">
                        <div className="absolute top-1.5 right-2.5 text-[7px] font-black text-white/30 uppercase tracking-widest">Logic Flow Map</div>
                        <code className="block font-mono text-[10px] text-neutral-200 whitespace-pre leading-relaxed">
                          {content}
                        </code>
                      </div>
                    );
                  }

                  if (content.startsWith('[STEP')) {
                    return (
                      <div className="mt-8 mb-3 text-white font-black uppercase tracking-tight text-[14px] border-b border-white/20 pb-2 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        {children}
                      </div>
                    );
                  }
                  if (content.includes('Step-by-Step Breakdown')) {
                    return (
                      <div className="text-[15px] font-black text-white mt-10 mb-6 border-b-2 border-white/10 pb-3 uppercase tracking-widest">
                        {children}
                      </div>
                    );
                  }
                  return <div className="mb-3 last:mb-0 text-neutral-300">{children}</div>;
                },
                ul({ children }) {
                  return <ul className="space-y-4 my-4">{children}</ul>;
                },
                li({ children }) {
                  return <li className="text-[12px] leading-relaxed list-none">{children}</li>;
                },
                strong({ children }) {
                  const rawLabel = React.Children.toArray(children).join('');
                  const cleanLabel = rawLabel.replace(/[:\s]+$/, '');
                  const isLabel = ['Action', 'Logic', 'Data', 'Input', 'Transformation', 'Variable', 'Returns'].some(l => cleanLabel.toLowerCase().startsWith(l.toLowerCase()));
                  if (isLabel) {
                    return (
                      <div className="mt-2 first:mt-0">
                        <span className="text-white/80 font-bold mr-1 uppercase text-[9px] tracking-wider">{cleanLabel}:</span>
                      </div>
                    );
                  }
                  return <strong className="text-white font-bold">{children}</strong>;
                },
                code({ node, inline, className, children, ...props }: any) {
                  const content = String(children).trim();
                  const isMermaid = content.startsWith('graph TD') || content.startsWith('flowchart');

                  if (inline) {
                    return (
                      <code className="bg-neutral-800/50 px-1.5 py-0.5 rounded text-neutral-300 font-mono text-[11px] border border-white/10" {...props}>
                        {children}
                      </code>
                    );
                  }

                  if (isMermaid) {
                    return (
                      <div className="my-4 p-3 bg-white/5 border border-dashed border-white/20 rounded-xl relative overflow-x-auto">
                        <div className="absolute top-1.5 right-2.5 text-[7px] font-black text-white/30 uppercase tracking-widest">Logic Flow Map</div>
                        <code className="block font-mono text-[10px] text-neutral-200 whitespace-pre leading-relaxed" {...props}>
                          {children}
                        </code>
                      </div>
                    );
                  }

                  return (
                    <span className="inline-block overflow-x-auto max-w-full my-0.5 align-middle">
                      <code className="inline-block bg-neutral-900/80 px-2 py-0.5 rounded-md border border-white/10 text-neutral-200 whitespace-pre font-mono text-[11px] leading-tight" {...props}>
                        {children}
                      </code>
                    </span>
                  );
                }
              }}
            >
              {data.call_flow_markdown}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
                    <div className="h-64 flex flex-col items-center justify-center text-neutral-700 gap-4 opacity-50">
                      <GitBranch size={48} />
                      <p className="text-xs font-medium">No trace map generated</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
});
