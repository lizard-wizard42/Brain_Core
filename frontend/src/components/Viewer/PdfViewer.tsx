type PdfViewerProps = {
  url: string;
  title?: string;
  className?: string;
};

export function PdfViewer({ url, title, className }: PdfViewerProps) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[#242424] bg-[#151515]">
        <div className="min-w-0">
          <p className="text-[12px] text-gray-300 truncate">{title ?? 'Documento PDF'}</p>
          <p className="text-[10px] text-gray-500">Visualização nativa do navegador</p>
        </div>
      </div>

      <div className="p-4 flex items-center justify-center bg-[#101010]">
        <iframe
          src={url}
          title={title ?? 'Documento PDF'}
          className="w-full h-[700px] rounded border border-[#222] bg-white"
        />
      </div>
    </div>
  );
}
