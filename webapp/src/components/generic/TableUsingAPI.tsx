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
import { Download } from '@phosphor-icons/react';
import Spinner from './Spinner';

// Extend ColumnDef to support custom CSV value extraction
export type ExtendedColumnDef<T> = ColumnDef<T> & {
  /**
   * Optional function to extract a string value for CSV export.
   * If not provided, falls back to accessorFn, accessorKey, or a default string conversion.
   */
  csvValue?: (row: T) => string | null | undefined;
};

export interface PageableData<T> {
  hits: T[];
  offset?: number;
  limit?: number;
  total?: number;
}

export interface TableUsingAPIProps<T> {
	/**
	 * The data to display (if not using loadData)
	 */
  data?: PageableData<T>;
  /**
   * The function to load data from the server (if not providing `data`)
   */
  loadData?: (query: string) => Promise<PageableData<T>>;
  columns: ExtendedColumnDef<T>[];
  showSearch?: boolean;
  searchPlaceholder?: string;
  searchDebounceMs?: number;
  pageSize?: number;
  enableInMemoryFiltering?: boolean;
  initialSorting?: SortingState;
  refetchInterval?: number;
  onRowClick?: (row: T) => void;
  /**
   * Unique identifier for this table instance to prevent cache collisions.
   * Should be unique per page/context where the table is used.
   */
  queryKeyPrefix?: string | string[];
}

function TableUsingAPI<T extends Record<string, any>>({
	data,
  loadData,
  columns,
  showSearch = true,
  searchPlaceholder = 'Search...',
  searchDebounceMs = 1000,
  pageSize = 50,
  enableInMemoryFiltering = true,
  initialSorting = [],
  refetchInterval,
  onRowClick,
  queryKeyPrefix,
}: TableUsingAPIProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [serverQuery, setServerQuery] = useState('');
  // Load data from server when debounced query changes
  // Use useQuery to cache
  const queryClient = useQueryClient();
  // data provided? use it (via a constant function, so useQuery below is not conditional)
  if (data) {
	loadData = () => Promise.resolve(data);
  }
  
  // Debounce input value to serverQuery
  useEffect(() => {
    const timer = setTimeout(() => {
      setServerQuery(inputValue);
      setCurrentPage(0); // Reset to first page on search change
    }, searchDebounceMs);
    
    return () => clearTimeout(timer);
  }, [inputValue, searchDebounceMs]);
  
  // Build unique query key to prevent cache collisions between different table instances
  const queryKey = useMemo(() => {
    const baseKey = ['table-data'];
    if (queryKeyPrefix) {
      const prefix = Array.isArray(queryKeyPrefix) ? queryKeyPrefix : [queryKeyPrefix];
      baseKey.push(...prefix);
    }
    baseKey.push(serverQuery);
    return baseKey;
  }, [queryKeyPrefix, serverQuery]);
  
  const { data: loadedData, isLoading, error: loadError } = useQuery({
    queryKey,
    queryFn: () => loadData(serverQuery),
	refetchInterval,
  });
  const hits = loadedData?.hits || [];
  const total = loadedData?.total || 0;
  const offset = loadedData?.offset || 0;
  const limit = loadedData?.limit || pageSize;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
  };

  // Generate CSV from all rows (not just paginated)
  const generateCSV = (): string => {
    const visibleColumns = columns.filter(col => {
      // Skip columns without headers (like action buttons)
      const header = typeof col.header === 'string' ? col.header : (col as any).id || '';
      return header !== '';
    });

    // Get header row
    const headers = visibleColumns.map(col => {
      const header = typeof col.header === 'string' ? col.header : (col as any).id || '';
      return escapeCSVValue(header);
    });

    // Get data rows from all filtered/sorted rows
    const rows = allRows.map(row => {
      return visibleColumns.map(col => {
        // Use csvValue if provided
        if ((col as ExtendedColumnDef<T>).csvValue) {
          const value = (col as ExtendedColumnDef<T>).csvValue!(row.original);
          return escapeCSVValue(value);
        }
        
        // Try accessorFn (may not exist on all ColumnDef variants)
        const accessorFn = (col as any).accessorFn;
        if (accessorFn) {
          const value = accessorFn(row.original, row.index);
          return escapeCSVValue(value);
        }
        
        // Try accessorKey (may not exist on all ColumnDef variants)
        const accessorKey = (col as any).accessorKey;
        if (accessorKey) {
          const value = (row.original as any)[accessorKey];
          return escapeCSVValue(value);
        }
        
        // Fallback: try to get value by column id
        const colId = (col as any).id;
        if (colId) {
          const value = (row.original as any)[colId];
          return escapeCSVValue(value);
        }
        
        return '';
      });
    });

    // Combine headers and rows
    const csvRows = [headers, ...rows];
    return csvRows.map(row => row.join(',')).join('\n');
  };

  // Escape CSV value (handle commas, quotes, newlines)
  const escapeCSVValue = (value: any): string => {
    if (value === null || value === undefined) {
      return '';
    }
    
    const str = String(value);
    // If contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const handleDownloadCSV = () => {
    const csv = generateCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `table-export-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
  
  const totalRows = allRows.length;
  const totalPages = Math.ceil(totalRows / pageSize);
  
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    window.scrollTo(0, 0);
  };

  if (isLoading && hits.length === 0) {
    return (
      <Card>
        <CardBody>
          <Spinner centered />
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
        {showSearch && <div className="mb-3 d-flex align-items-center" style={{ gap: '0.5rem' }}>
          <Input
            type="search"
            placeholder={searchPlaceholder}
            value={inputValue}
            onChange={handleSearchChange}
            className="flex-grow-1"
          />
          <Button onClick={refresh} className="flex-shrink-0">Refresh</Button>
          <Button onClick={handleDownloadCSV} className="flex-shrink-0" color="secondary">
            <Download size={16} className="me-1" style={{ verticalAlign: 'middle' }} />
            Download CSV
          </Button>
        </div>}
        {!showSearch && totalRows > 0 && (
          <div className="mb-3 d-flex justify-content-end">
            <Button onClick={handleDownloadCSV} className="flex-shrink-0" color="secondary">
              <Download size={16} className="me-1" style={{ verticalAlign: 'middle' }} />
              Download CSV
            </Button>
          </div>
        )}

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

