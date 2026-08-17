"use client";
import * as React from "react";
import {
  ColumnDef, flexRender, getCoreRowModel, useReactTable,
} from "@tanstack/react-table";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Inbox } from "lucide-react";

interface DataTableProps<TData extends object, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function DataTable<TData extends object, TValue>({
  columns,
  data,
  pageSize = 10,
  emptyTitle = "No records found",
  emptyDescription = "Try adjusting your search or filters.",
}: DataTableProps<TData, TValue>) {
  const [pageIndex, setPageIndex] = React.useState(0);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { pagination: { pageIndex, pageSize } },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater({ pageIndex, pageSize }) : updater;
      setPageIndex(next.pageIndex);
    },
    manualPagination: false,
    getPaginationRowModel: undefined,
  });

  React.useEffect(() => setPageIndex(0), [data.length]);

  const start = pageIndex * pageSize;
  const rows = table.getRowModel().rows;
  const pageRows = rows.slice(start, start + pageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  if (data.length === 0) {
    return <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted-foreground">
          Showing {start + 1}–{Math.min(start + pageSize, rows.length)} of {rows.length}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {pageIndex + 1} of {pageCount}
          </span>
          <Button variant="outline" size="sm" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
