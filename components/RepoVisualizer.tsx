import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { RepoFile } from '../types';

interface RepoVisualizerProps {
  files: RepoFile[];
  onSelectFile: (path: string) => void;
}

export const RepoVisualizer: React.FC<RepoVisualizerProps> = ({ files, onSelectFile }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || files.length === 0) return;

    const renderMap = () => {
      if (!svgRef.current) return;
      const width = svgRef.current.clientWidth;
      const height = svgRef.current.clientHeight;

      if (width === 0 || height === 0) return;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();

      const g = svg.append("g");
      const tooltip = d3.select(tooltipRef.current);

      // Create hierarchy
      const data: any = { name: "root", children: [] };
      files.forEach(file => {
        const parts = file.path.split('/');
        let current = data;
        parts.forEach((part, i) => {
          if (!current.children) current.children = [];
          let node = current.children.find((c: any) => c.name === part);
          if (!node) {
            node = { name: part, path: parts.slice(0, i + 1).join('/') };
            current.children.push(node);
          }
          current = node;
        });
      });

      const root = d3.hierarchy(data)
        .sum(d => d.children ? 0 : 1)
        .sort((a, b) => (b.value || 0) - (a.value || 0));

      const pack = d3.pack()
        .size([width, height])
        .padding(4);

      pack(root);

      const nodes = g.selectAll("g")
        .data(root.descendants() as d3.HierarchyCircularNode<any>[])
        .enter()
        .append("g")
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .style("cursor", d => d.children ? "default" : "pointer")
        .on("mouseover", (event, d: any) => {
          if (d.data.name === "root") return;
          
          d3.select(event.currentTarget).select("circle")
            .transition().duration(200)
            .attr("stroke", "#ffffff")
            .attr("stroke-width", 3)
            .attr("fill-opacity", 0.8);

          tooltip.transition().duration(200).style("opacity", 1);
          tooltip.html(`
            <div class="flex flex-col gap-1">
              <div class="text-white font-bold text-xs mono">${d.data.name}</div>
              <div class="text-neutral-500 text-[10px] mono break-all">${d.data.path || ''}</div>
              ${d.children ? `<div class="text-neutral-600 text-[9px] uppercase mt-1 font-bold tracking-tighter">${d.children.length} items</div>` : ''}
            </div>
          `)
          .style("left", (event.pageX + 15) + "px")
          .style("top", (event.pageY - 28) + "px");
        })
        .on("mousemove", (event) => {
          tooltip.style("left", (event.pageX + 15) + "px")
                 .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", (event, d: any) => {
          d3.select(event.currentTarget).select("circle")
            .transition().duration(200)
            .attr("stroke", d.children ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.3)")
            .attr("stroke-width", 1)
            .attr("fill-opacity", 0.4);
            
          tooltip.transition().duration(200).style("opacity", 0);
        })
        .on("click", (event, d: any) => {
          if (!d.children && d.data.path) {
            onSelectFile(d.data.path);
          }
        });

      nodes.append("circle")
        .attr("r", d => d.r)
        .attr("fill", d => d.children ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 255, 255, 0.1)")
        .attr("stroke", d => d.children ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.3)")
        .attr("stroke-width", 1)
        .attr("fill-opacity", 0.4);

      // Only show labels for leaf nodes or large enough containers
      nodes.filter(d => {
        // Don't show root label
        if (d.depth === 0) return false;
        // Show if it's a leaf and has enough space
        if (!d.children && d.r > 15) return true;
        // Show if it's a folder and is quite large
        if (d.children && d.r > 40) return true;
        return false;
      })
        .append("text")
        .attr("dy", d => d.children ? -d.r + 15 : ".3em")
        .style("text-anchor", "middle")
        .style("font-size", d => Math.min(d.r / 4, 11))
        .style("font-weight", d => d.children ? "800" : "400")
        .style("fill", d => d.children ? "rgba(255, 255, 255, 0.4)" : "rgba(255, 255, 255, 0.8)")
        .style("pointer-events", "none")
        .style("text-transform", d => d.children ? "uppercase" : "none")
        .style("letter-spacing", d => d.children ? "0.1em" : "normal")
        .text(d => {
          const name = d.data.name;
          if (name.length > d.r / 3 && d.r < 50) {
            return name.substring(0, Math.floor(d.r / 4)) + "...";
          }
          return name;
        });

      // Zoom behavior
      const zoom = d3.zoom()
        .scaleExtent([0.1, 10])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        });

      svg.call(zoom as any);

      // Initial zoom to fit
      const initialScale = 0.8;
      svg.call(zoom.transform as any, d3.zoomIdentity.translate(width/2, height/2).scale(initialScale).translate(-width/2, -height/2));
    };

    const resizeObserver = new ResizeObserver(() => {
      renderMap();
    });

    resizeObserver.observe(svgRef.current);
    renderMap();

    return () => resizeObserver.disconnect();
  }, [files, onSelectFile]);

  return (
    <div className="w-full h-full relative bg-black overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />
      
      <div 
        ref={tooltipRef}
        className="fixed pointer-events-none opacity-0 z-[1000] bg-neutral-950/95 border border-white/10 p-3 rounded-xl shadow-2xl backdrop-blur-md min-w-[150px] max-w-[300px]"
      />

      <div className="absolute bottom-4 left-4 flex flex-col gap-2">
        <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold bg-neutral-900/80 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-sm flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
          Interactive Repo Map
        </div>
        <div className="text-[9px] text-neutral-600 bg-neutral-900/40 px-3 py-1 rounded-full border border-white/5 backdrop-blur-sm">
          Scroll to zoom • Drag to pan • Hover for details
        </div>
      </div>
    </div>
  );
};

