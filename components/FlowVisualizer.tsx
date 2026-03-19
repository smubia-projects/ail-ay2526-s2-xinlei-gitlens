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

export const FlowVisualizer: React.FC<FlowVisualizerProps> = ({ data, onClose, onNavigate }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [sidebarTab, setSidebarTab] = useState<'usages' | 'trace'>('usages');

  useEffect(() => {
    if (data.call_flow_markdown && !data.usage_examples?.length) {
      setSidebarTab('trace');
    }
  }, [data]);

  useEffect(() => {
    if (!svgRef.current || data.nodes.length === 0) return;

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
        .attr("refX", 25) // Adjusted to be outside the node rect
        .attr("refY", 0)
        .attr("orient", "auto")
        .attr("markerWidth", 8)
        .attr("markerHeight", 8)
        .attr("xoverflow", "visible")
        .append("svg:path")
        .attr("d", "M 0,-5 L 10 ,0 L 0,5")
        .attr("fill", "#3b82f6") // Solid blue for better visibility
        .style("stroke", "none");

      const simulation = d3.forceSimulation(data.nodes as any)
        .force("link", d3.forceLink(data.links).id((d: any) => d.id).distance(180))
        .force("charge", d3.forceManyBody().strength(-600))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(80));

      // Run simulation to completion immediately
      for (let i = 0; i < 300; ++i) simulation.tick();

      const link = g.append("g")
        .selectAll("line")
        .data(data.links)
        .enter()
        .append("line")
        .attr("stroke", "rgba(59, 130, 246, 0.4)")
        .attr("stroke-width", 2)
        .attr("marker-end", "url(#arrowhead)")
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

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
        .attr("width", 120)
        .attr("height", 40)
        .attr("x", -60)
        .attr("y", -20)
        .attr("rx", 8)
        .attr("fill", d => d.type === 'file' ? "rgba(15, 23, 42, 0.9)" : "rgba(30, 41, 59, 0.9)")
        .attr("stroke", d => d.type === 'file' ? "rgba(71, 85, 105, 0.5)" : "rgba(59, 130, 246, 0.5)")
        .attr("stroke-width", 1);

      node.append("text")
        .attr("dy", "-2")
        .attr("text-anchor", "middle")
        .style("fill", "#fff")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .style("pointer-events", "none")
        .text(d => d.label.length > 15 ? d.label.substring(0, 12) + "..." : d.label);

      node.append("text")
        .attr("dy", "12")
        .attr("text-anchor", "middle")
        .style("fill", "rgba(255, 255, 255, 0.4)")
        .style("font-size", "9px")
        .style("pointer-events", "none")
        .text(d => (d.file || '').split('/').pop() || '');

      // No need for tick handler if we run simulation to completion

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
      
      // Center and scale to fit
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
    <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl z-[100] flex flex-col animate-in fade-in duration-300">
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
            <Code2 size={18} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-white uppercase tracking-widest">Logic Flow Visualizer</span>
            <span className="text-[10px] text-slate-500 font-mono">Tracing cross-file dependencies and call hierarchy</span>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white"
        >
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 flex relative overflow-hidden">
        <div className="flex-1 relative">
          <svg ref={svgRef} className="w-full h-full" />
          <div className="absolute bottom-6 left-6 flex flex-col gap-2 pointer-events-none">
            <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl backdrop-blur-md shadow-2xl">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Legend</div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-blue-500/20 border border-blue-500/50" />
                  <span className="text-[10px] text-slate-300">Function / Symbol</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-slate-800 border border-slate-700" />
                  <span className="text-[10px] text-slate-300">File Reference</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-[1px] bg-blue-500/30" />
                  <span className="text-[10px] text-slate-300">Call / Dependency</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {hasSidebar && (
          <aside className="w-96 border-l border-slate-800 bg-slate-900/50 backdrop-blur-md flex flex-col overflow-hidden animate-in slide-in-from-right duration-500">
            <div className="border-b border-slate-800 bg-slate-950/50 p-2 flex gap-1">
              <button 
                onClick={() => setSidebarTab('usages')}
                className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${sidebarTab === 'usages' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:bg-slate-800'}`}
              >
                <Info size={14} /> Usages
              </button>
              <button 
                onClick={() => setSidebarTab('trace')}
                className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${sidebarTab === 'trace' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:bg-slate-800'}`}
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
                        className="bg-slate-950/80 border border-slate-800 p-4 rounded-2xl hover:border-blue-500/50 transition-all cursor-pointer group"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 text-blue-400">
                            <FileCode size={14} />
                            <span className="text-[11px] font-bold mono truncate max-w-[150px]">{(ex.file || '').split('/').pop()}</span>
                          </div>
                          <span className="text-[10px] mono text-slate-600 font-bold">L{ex.line}</span>
                        </div>
                        
                        <div className="space-y-3">
                          <div className="bg-blue-500/5 border border-blue-500/10 p-2.5 rounded-xl">
                            <div className="text-[9px] uppercase font-bold text-blue-400/70 mb-1">Invoked with</div>
                            <div className="text-[11px] mono text-blue-300 break-all bg-slate-900/50 p-2 rounded-lg border border-slate-800/50">
                              {ex.arguments}
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed italic">
                            {ex.context_explanation}
                          </p>
                        </div>
                        
                        <div className="mt-3 flex items-center justify-end text-[9px] font-bold text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">
                          View in file <ArrowRight size={10} className="ml-1" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="h-64 flex flex-col items-center justify-center text-slate-700 gap-4 opacity-50">
                      <Info size={48} />
                      <p className="text-xs font-medium">No usage examples found</p>
                    </div>
                  )}
                </div>
              ) : (
    <div className="animate-in fade-in duration-300">
      {data.call_flow_markdown ? (
        <div className="bg-slate-950/80 border border-slate-800 p-6 rounded-2xl overflow-hidden shadow-inner">
          <div className="text-[12px] text-blue-400 uppercase font-black mb-6 flex items-center gap-2 tracking-[0.2em] border-b border-blue-500/20 pb-3">
            <Network size={16} className="text-blue-500" /> Call Hierarchy & Logic Trace
          </div>
          <div className="text-[12px] leading-relaxed pl-3 border-l border-blue-500/30 overflow-x-auto">
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              components={{
                p({ children }) {
                  const content = React.Children.toArray(children).join('');
                  const isMermaid = content.trim().startsWith('graph TD') || content.trim().startsWith('flowchart');
                  
                  if (isMermaid) {
                    return (
                      <div className="my-4 p-3 bg-blue-500/5 border border-dashed border-blue-500/20 rounded-xl relative overflow-x-auto">
                        <div className="absolute top-1.5 right-2.5 text-[7px] font-black text-blue-500/30 uppercase tracking-widest">Logic Flow Map</div>
                        <code className="block font-mono text-[10px] text-blue-200 whitespace-pre leading-relaxed">
                          {content}
                        </code>
                      </div>
                    );
                  }

                  if (content.startsWith('[STEP')) {
                    return (
                      <div className="mt-8 mb-3 text-blue-400 font-black uppercase tracking-tight text-[14px] border-b border-blue-500/20 pb-2 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                        {children}
                      </div>
                    );
                  }
                  if (content.includes('Step-by-Step Breakdown')) {
                    return (
                      <div className="text-[15px] font-black text-white mt-10 mb-6 border-b-2 border-slate-800 pb-3 uppercase tracking-widest">
                        {children}
                      </div>
                    );
                  }
                  return <div className="mb-3 last:mb-0 text-slate-300">{children}</div>;
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
                        <span className="text-blue-400/80 font-bold mr-1 uppercase text-[9px] tracking-wider">{cleanLabel}:</span>
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
                      <code className="bg-slate-800/50 px-1.5 py-0.5 rounded text-blue-300 font-mono text-[11px] border border-slate-700/30" {...props}>
                        {children}
                      </code>
                    );
                  }

                  if (isMermaid) {
                    return (
                      <div className="my-4 p-3 bg-blue-500/5 border border-dashed border-blue-500/20 rounded-xl relative overflow-x-auto">
                        <div className="absolute top-1.5 right-2.5 text-[7px] font-black text-blue-500/30 uppercase tracking-widest">Logic Flow Map</div>
                        <code className="block font-mono text-[10px] text-blue-200 whitespace-pre leading-relaxed" {...props}>
                          {children}
                        </code>
                      </div>
                    );
                  }

                  return (
                    <span className="inline-block overflow-x-auto max-w-full my-0.5 align-middle">
                      <code className="inline-block bg-slate-900/80 px-2 py-0.5 rounded-md border border-slate-800 text-blue-200 whitespace-pre font-mono text-[11px] leading-tight" {...props}>
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
                    <div className="h-64 flex flex-col items-center justify-center text-slate-700 gap-4 opacity-50">
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
};
