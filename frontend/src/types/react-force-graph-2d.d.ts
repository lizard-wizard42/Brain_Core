declare module 'react-force-graph-2d' {
  import { ComponentType } from 'react';

  export interface ForceGraphMethods<NodeType = any, LinkType = any> {
    centerAt(x?: number, y?: number, durationMs?: number): this;
    zoom(zoomLevel?: number, durationMs?: number): this;
    zoomToFit(durationMs?: number, padding?: number, customNodeFilter?: (node: NodeType) => boolean): this;
    d3Force(forceName: string, forceFn?: any): this;
  }

  export interface ForceGraphProps<NodeType = any, LinkType = any> {
    ref?: any;
    width?: number;
    height?: number;
    graphData?: { nodes: NodeType[]; links: LinkType[] };
    nodeLabel?: string | ((node: NodeType) => string);
    nodeRelSize?: number;
    nodeVal?: number | string | ((node: NodeType) => number);
    nodeColor?: string | ((node: NodeType) => string);
    linkColor?: string | ((link: LinkType) => string);
    linkWidth?: number | string | ((link: LinkType) => number);
    linkDirectionalParticles?: number | string | ((link: LinkType) => number);
    linkDirectionalParticleWidth?: number | string | ((link: LinkType) => number);
    linkDirectionalParticleSpeed?: number | string | ((link: LinkType) => number);
    onNodeHover?: (node: NodeType | null, previousNode: NodeType | null) => void;
    onNodeClick?: (node: NodeType, event: MouseEvent) => void;
    nodeCanvasObject?: (node: NodeType, ctx: CanvasRenderingContext2D, globalScale: number) => void;
  }

  const ForceGraph2D: ComponentType<ForceGraphProps>;
  export default ForceGraph2D;
}
