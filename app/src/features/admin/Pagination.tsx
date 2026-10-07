import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  label = "registros",
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  const [jump, setJump] = useState(String(page));
  useEffect(() => setJump(String(page)), [page]);
  if (totalPages <= 1)
    return (
      <div className="pagination single">
        <span>{totalItems} {label}</span>
      </div>
    );
  const start = (page - 1) * pageSize + 1,
    end = Math.min(page * pageSize, totalItems);
  const commitJump = () => {
    const next = Math.min(Math.max(1, Number(jump) || page), totalPages);
    setJump(String(next));
    if (next !== page) onPageChange(next);
  };
  return (
    <nav className="pagination" aria-label={"Paginación de " + label}>
      <span>{start}–{end} de {totalItems}</span>
      <div>
        <button
          type="button"
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="pagination-jump">
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jump}
            aria-label={`Ir a la página (1 a ${totalPages})`}
            onChange={(event) => setJump(event.target.value)}
            onBlur={commitJump}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitJump();
            }}
          />
          <span>/ {totalPages}</span>
        </span>
        <button
          type="button"
          aria-label="Página siguiente"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}
