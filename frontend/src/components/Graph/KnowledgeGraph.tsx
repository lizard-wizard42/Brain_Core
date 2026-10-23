import { useEffect, useRef, useState, useMemo } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { api } from '../../api/client';
import type { GraphData, GraphNode, TreePage } from '../../types';

interface KnowledgeGraphProps {
  onOpenPage: (page: TreePage) => void;
  activePageId?: string | null;
}

export function KnowledgeGraph({ onOpenPage, activePageId }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GraphNode, any>>(null);

  const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string>('all');
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    let active = true;
    if (typeof api.getGraph !== 'function') {
      setLoading(false);
      return;
    }
    api.getGraph()
      .then((res: GraphData) => {
        if (!active) return;
        setData(res);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError('Não foi possível carregar o grafo de conhecimento');
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of data.nodes) {
      if (Array.isArray(n.tags)) {
        for (const t of n.tags) set.add(t);
      }
    }
    return Array.from(set).sort();
  }, [data.nodes]);

  const filteredData = useMemo(() => {
    if (filterTag === 'all') return data;
    const matchingNodeIds = new Set(
      data.nodes.filter((n: GraphNode) => n.tags?.includes(filterTag)).map((n: GraphNode) => n.id)
    );
    const filteredNodes = data.nodes.filter((n: GraphNode) => matchingNodeIds.has(n.id));
    const filteredLinks = data.links.filter(
      (l: any) => matchingNodeIds.has(typeof l.source === 'object' ? l.source.id : l.source) &&
                  matchingNodeIds.has(typeof l.target === 'object' ? l.target.id : l.target)
    );
    return { nodes: filteredNodes, links: filteredLinks };
  }, [data, filterTag]);

  // Center on active node if present
  useEffect(() => {
    if (activePageId && fgRef.current && data.nodes.length > 0) {
      const target = data.nodes.find((n: GraphNode) => n.id === activePageId);
      if (target && (target as any).x !== undefined) {
        fgRef.current.centerAt((target as any).x, (target as any).y, 800);
        fgRef.current.zoom(2.5, 800);
      }
    }
  }, [activePageId, data.nodes]);

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-sm text-[var(--theme-muted)]">
        Carregando grafo de conhecimento…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-sm text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full flex-1 overflow-hidden bg-[#121212]">
      {/* Overlay Toolbar */}
      <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-[#2b2b2b] bg-[#1a1a1a]/90 p-2 shadow-lg backdrop-blur-md">
        <span className="text-xs font-semibold text-gray-300">Grafo:</span>
        <span className="rounded bg-[#282828] px-2 py-0.5 text-[11px] text-gray-400">
          {filteredData.nodes.length} nós · {filteredData.links.length} conexões
        </span>

        {allTags.length > 0 && (
          <select
            className="rounded border border-[#383838] bg-[#222222] px-2 py-1 text-xs text-gray-200"
            value={filterTag}
            onChange={e => setFilterTag(e.target.value)}
          >
            <option value="all">Todas as tags</option>
            {allTags.map((t: string) => (
              <option key={t} value={t}>#{t}</option>
            ))}
          </select>
        )}

        <button
          type="button"
          className="rounded border border-[#383838] bg-[#242424] px-2 py-1 text-xs text-gray-300 hover:bg-[#323232]"
          onClick={() => fgRef.current?.zoomToFit(400, 40)}
          title="Ajustar visualização"
        >
          Reset Zoom
        </button>
      </div>

      {/* Hover Info Tooltip */}
      {hoverNode && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-lg border border-[#333] bg-[#1e1e1e]/95 px-3 py-2 text-xs text-gray-200 shadow-xl backdrop-blur-sm">
          <p className="font-semibold text-white">{hoverNode.title}</p>
          <p className="text-[10px] text-gray-400">Grau de conexões: {hoverNode.val}</p>
          {hoverNode.tags?.length > 0 && (
            <p className="mt-1 text-[10px] text-blue-400">{hoverNode.tags.map((t: string) => `#${t}`).join(' ')}</p>
          )}
        </div>
      )}

      {/* 2D Force Graph Canvas */}
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={filteredData}
        nodeLabel=""
        nodeRelSize={4}
        nodeVal={(n: any) => (n as GraphNode).val}
        nodeColor={(n: any) => {
          const node = n as GraphNode;
          if (node.id === activePageId) return '#60a5fa';
          if (node.type === 'notebook') return '#f59e0b';
          if (node.type === 'infinite') return '#a855f7';
          return '#10b981';
        }}
        linkColor={(l: any) => l.kind === 'parent' ? '#3b4252' : '#88c0d0'}
        linkWidth={(l: any) => l.kind === 'parent' ? 1.5 : 1}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleSpeed={0.005}
        onNodeHover={(node: any) => setHoverNode(node ? (node as GraphNode) : null)}
        onNodeClick={(node: any) => {
          const gn = node as GraphNode;
          onOpenPage({
            id: gn.id,
            title: gn.title,
            slug: gn.id,
            type: gn.type as any,
            icon: gn.icon,
            updated_at: '',
            sort_order: 0,
            children: [],
          });
        }}
        nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const label = node.title;
          const fontSize = Math.max(10 / globalScale, 3);
          ctx.font = `${fontSize}px Sans-Serif`;

          // Draw node circle
          const r = Math.sqrt(Math.max(0, node.val || 1)) * 4;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
          ctx.fillStyle = node.id === activePageId ? '#38bdf8' : (node.type === 'notebook' ? '#f59e0b' : '#34d399');
          ctx.fill();

          // Outer ring for active or high degree
          if (node.id === activePageId || node.val > 3) {
            ctx.lineWidth = 1.5 / globalScale;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
          }

          // Draw label below node if zoomed in enough or high degree
          if (globalScale > 0.8 || node.val > 2) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#e5e7eb';
            ctx.fillText(label, node.x, node.y + r + 2);
          }
        }}
      />
    </div>
  );
}
