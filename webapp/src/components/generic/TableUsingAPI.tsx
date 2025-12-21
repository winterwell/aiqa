import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  HeaderGroup,
  Header,
  Row,
  Cell,
} from '@tanstack/react-table';
import { Input, Table, Pagination, PaginationItem, PaginationLink, Card, CardBody, Button } from 'reactstrap';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface PageableData<T> {
  hits: T[];
  offset: number;
  limit: number;
  total?: number;
}

export interface TableUsingAPIProps<T> {
  loadData: (query: string) => Promise<PageableData<T>>;
  columns: ColumnDef<T>[];
  searchPlaceholder?: string;
  searchDebounceMs?: number;
  pageSize?: number;
  enableInMemoryFiltering?: boolean;
  initialSorting?: SortingState;
  onRowClick?: (row: T) => void;
}

function TableUsingAPI<T extends Record<string, any>>({
  loadData,
  columns,
  searchPlaceholder = 'Search...',
  searchDebounceMs = 500,
  pageSize = 50,
  enableInMemoryFiltering = true,
  initialSorting = [],
  onRowClick,
}: TableUsingAPIProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [serverQuery, setServerQuery] = useState('');
  // Load data from server when debounced query changes
  // Use useQuery to cache
  const queryClient = useQueryClient();
  const { data: loadedData, isLoading, error: loadError } = useQuery({
    queryKey: ['table-data', serverQuery],
    queryFn: () => loadData(serverQuery),
  });
  const hits = loadedData?.hits || [];
  const total = loadedData?.total || 0;
  const offset = loadedData?.offset || 0;
  const limit = loadedData?.limit || pageSize;

//   // Debug logging
//   useEffect(() => {
//     console.log('[TableUsingAPI] Data state:', {
//       isLoading,
//       hasError: !!loadError,
//       error: loadError?.message,
//       hitsCount: hits.length,
//       total,
//       offset,
//       limit,
//       firstHit: hits[0] ? { keys: Object.keys(hits[0]), sample: hits[0] } : null,
//     });
//   }, [isLoading, loadError, hits, total, offset, limit]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['table-data', serverQuery] });
  };

  // Configure table with sorting and filtering
  const table = useReactTable({
    data: hits,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: enableInMemoryFiltering ? getFilteredRowModel() : undefined,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      globalFilter: enableInMemoryFiltering ? globalFilter : '',
    },
    globalFilterFn: (row, columnId, filterValue: string) => {
      // Simple global filter that searches all string values
      const search = filterValue.toLowerCase();
      return Object.values(row.original).some((value) => {
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(search);
      });
    },
  });

  // Get all rows from table
  const allRows = table.getRowModel().rows;
  
  // Get paginated rows (calculate directly, no memoization needed for simple slice)
  const start = currentPage * pageSize;
  const paginatedRows = allRows.slice(start, start + pageSize);
  
//   // Debug logging
//   useEffect(() => {
//     console.log('[TableUsingAPI] Pagination:', {
//       totalRows: allRows.length,
//       currentPage,
//       pageSize,
//       start,
//       end: start + pageSize,
//       paginatedCount: paginatedRows.length,
//       paginatedRowIds: paginatedRows.map(r => r.id),
//       firstRowData: paginatedRows[0]?.original || null,
//       rowsArrayLength: allRows.length,
//       rowsArraySample: allRows.length > 0 ? { id: allRows[0].id, original: allRows[0].original } : null,
//     });
//   }, [allRows.length, currentPage, pageSize, paginatedRows.length]);

  const totalRows = allRows.length;
  const totalPages = Math.ceil(totalRows / pageSize);
  
//   useEffect(() => {
//     console.log('[TableUsingAPI] Table state:', {
//       totalRows,
//       totalPages,
//       columnsCount: columns.length,
//       columnIds: columns.map(c => c.id || (c as any).accessorKey),
//       globalFilter,
//       sorting,
//     });
//   }, [totalRows, totalPages, columns, globalFilter, sorting]);  

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setServerQuery(e.target.value);
    setCurrentPage(0); // Reset to first page on search change
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    window.scrollTo(0, 0);
  };

  if (isLoading && hits.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="text-center">
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardBody>
          <div className="alert alert-danger">
            <h4>Error</h4>
            <p>Failed to load data: {loadError.message}</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="table-container">
        <div className="mb-3">
          <Input
            type="text"
            placeholder={searchPlaceholder}
            value={serverQuery}
            onChange={handleSearchChange}
          />
		  <Button onClick={refresh}>Refresh</Button>
        </div>

        {totalRows === 0 ? (
          <p className="text-muted">No data found.</p>
        ) : (
          <>
            <p className="text-muted">
              Showing {currentPage * pageSize + 1}-{Math.min((currentPage + 1) * pageSize, totalRows)} of {totalRows} items
            </p>
            <Table hover responsive>
				<TableHeader headers={table.getHeaderGroups()} flexRender={flexRender} />
                <TableBody
                  paginatedRows={paginatedRows}
                  columns={columns}
                  totalRows={totalRows}
                  flexRender={flexRender}
                  onRowClick={onRowClick}
                />
            </Table>

            <TablePagination totalPages={totalPages} currentPage={currentPage} handlePageChange={handlePageChange} />
          </>
        )}
    </div>
  );
}

function TableHeader<T>({ headers, flexRender }: { headers: HeaderGroup<T>[], flexRender: <TProps extends object>(comp: any, props: TProps) => React.ReactNode }) {
	return ( <thead>
		{headers.map((headerGroup) => (
		  <tr key={headerGroup.id}>
			{headerGroup.headers.map((header) => (
			  <th
				key={header.id}
				style={{
				  cursor: header.column.getCanSort() ? 'pointer' : 'default',
				  userSelect: 'none',
				}}
				onClick={header.column.getToggleSortingHandler()}
			  >
				<div className="d-flex align-items-center">
				  {flexRender(header.column.columnDef.header, header.getContext())}
				  {header.column.getCanSort() && (
					<span className="ms-2">
					  {{
						asc: ' ↑',
						desc: ' ↓',
					  }[header.column.getIsSorted() as string] ?? ' ⇅'}
					</span>
				  )}
				</div>
			  </th>
			))}
		  </tr>
		))}
	  </thead>
	);
}

function TableBody<T>({ paginatedRows, columns, totalRows, flexRender, onRowClick }: { paginatedRows: Row<T>[], columns: ColumnDef<T>[], totalRows: number, flexRender: <TProps extends object>(comp: any, props: TProps) => React.ReactNode, onRowClick?: (row: T) => void }) {
	return (
		<tbody>
			{paginatedRows.map((row) => {
				const cells = row.getVisibleCells();
				return (
				  <tr 
					key={row.id}
					onClick={() => onRowClick?.(row.original)}
					style={onRowClick ? { cursor: 'pointer' } : undefined}
				  >
					{cells.map((cell) => {
					  const rendered = flexRender(cell.column.columnDef.cell, cell.getContext());
					  return (
						<td key={cell.id}>
						  {rendered}
						</td>
					  );
					})}
				  </tr>
				);
			})}
		</tbody>
	);
}

function TablePagination({ totalPages, currentPage, handlePageChange }: { totalPages: number, currentPage: number, handlePageChange: (page: number) => void }) {
	if (totalPages <= 1) return null;
	const displayPage = currentPage + 1;
	return (
		<Pagination className="mt-3">
		  <PaginationItem disabled={currentPage === 0}>
			<PaginationLink
			  previous
			  onClick={() => handlePageChange(Math.max(0, currentPage - 1))}
			/>
		  </PaginationItem>
		  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
			if (
			  page === 1 ||
			  page === totalPages ||
			  (page >= displayPage - 2 && page <= displayPage + 2)
			) {
			  return (
				<PaginationItem key={page} active={page === displayPage}>
				  <PaginationLink onClick={() => handlePageChange(page - 1)}>
					{page}
				  </PaginationLink>
				</PaginationItem>
			  );
			} else if (page === displayPage - 3 || page === displayPage + 3) {
			  return (
				<PaginationItem key={page} disabled>
				  <PaginationLink>...</PaginationLink>
				</PaginationItem>
			  );
			}
			return null;
		  })}
		  <PaginationItem disabled={currentPage >= totalPages - 1}>
			<PaginationLink
			  next
			  onClick={() => handlePageChange(Math.min(totalPages - 1, currentPage + 1))}
			/>
		  </PaginationItem>
		</Pagination>
	  )
}

export default TableUsingAPI;

