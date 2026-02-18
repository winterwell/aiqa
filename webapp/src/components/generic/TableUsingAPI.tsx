import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  FilterFn,
  HeaderGroup,
  Row,
  RowSelectionState,
} from '@tanstack/react-table';
import { Input, Table, Pagination, PaginationItem, PaginationLink, Card, CardBody, Button } from 'reactstrap';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DownloadIcon } from '@phosphor-icons/react';
import Spinner from './Spinner';
import './TableUsingAPI.css';

// Select all checkbox header component
function SelectAllCheckbox({ table }: { table: any }) {
  const checkboxRef = React.useRef<HTMLInputElement>(null);
  const isAllSelected = table.getIsAllRowsSelected();
  const isSomeSelected = table.getIsSomeRowsSelected();
  
  React.useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isSomeSelected && !isAllSelected;
    }
  }, [isAllSelected, isSomeSelected]);
  
  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      className="form-check-input"
      checked={isAllSelected}
      onChange={table.getToggleAllRowsSelectedHandler()}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

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
  /**
   * Callback fired when data is loaded from the server.
   */
  onDataLoaded?: (data: PageableData<T>) => void;
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
  /**
   * Enable row selection with checkboxes. When enabled, adds a selection column with a "select all" checkbox in the header.
   */
  enableRowSelection?: boolean;
  /**
   * Callback fired when row selection changes. Receives the selected row IDs and the selected row data.
   */
  onSelectionChange?: (selectedRowIds: string[], selectedRows: T[]) => void;
  /**
   * React node to render as bulk actions toolbar. Shown below the header when rows are selected.
   * Receives selected row IDs and selected row data as props.
   */
  bulkActionsToolbar?: (selectedRowIds: string[], selectedRows: T[]) => React.ReactNode;
  /**
   * Function to get a unique row ID. If not provided, uses array index (not recommended for selection).
   * Should return a stable identifier for each row.
   */
  getRowId?: (row: T) => string;
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
  enableRowSelection = false,
  onSelectionChange,
  bulkActionsToolbar,
  getRowId,
  onDataLoaded,
}: TableUsingAPIProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [serverQuery, setServerQuery] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Load data from server when debounced query changes
  // Use useQuery to cache
  const queryClient = useQueryClient();
  // data provided? use it (via a constant function, so useQuery below is not conditional)
  if (data) {
    loadData = () => Promise.resolve(data);
    onDataLoaded?.(data); 
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
    queryFn: () => {
      const promiseData = loadData(serverQuery);
      if (onDataLoaded) {
        promiseData.then((data: PageableData<T>) => {
          onDataLoaded(data);
        });
      }
      return promiseData;
    },
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

  // Create selection column if enabled
  const selectionColumn: ColumnDef<T> = useMemo(() => ({
    id: 'select',
    header: ({ table }) => <SelectAllCheckbox table={table} />,
    cell: ({ row }) => (
      <Input
        type="checkbox"
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onChange={row.getToggleSelectedHandler()}
        onClick={(e) => e.stopPropagation()}
      />
    ),
    enableSorting: false,
  }), []);

  const tableColumns = useMemo(() => {
    return enableRowSelection ? [selectionColumn, ...columns] : columns;
  }, [enableRowSelection, selectionColumn, columns]);

  const caseInsensitiveIncludesFilterFn: FilterFn<T> = (row, columnId, filterValue: string) => {
    const search = String(filterValue ?? '').toLowerCase();
    if (search === '') return true;
    const raw = row.getValue(columnId);
    if (raw === null || raw === undefined) return false;
    const value = String(raw).toLowerCase();
    return value.includes(search);
  };

  // Configure table with sorting and filtering
  const table = useReactTable({
    data: hits,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: enableInMemoryFiltering ? getFilteredRowModel() : undefined,
    filterFns: {
      caseInsensitiveIncludes: caseInsensitiveIncludesFilterFn,
    },
    defaultColumn: {
      filterFn: caseInsensitiveIncludesFilterFn,
    },
    enableColumnFilters: enableInMemoryFiltering,
    enableRowSelection: enableRowSelection,
    getRowId: getRowId,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters: enableInMemoryFiltering ? columnFilters : [],
      globalFilter: enableInMemoryFiltering ? globalFilter : '',
      rowSelection: enableRowSelection ? rowSelection : {},
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

  // Handle selection changes - use table's selected row model for accurate data
  useEffect(() => {
    if (enableRowSelection && onSelectionChange) {
      const selectedRowModel = table.getSelectedRowModel();
      const selectedRowIds = selectedRowModel.rows.map(row => row.id);
      const selectedRows = selectedRowModel.rows.map(row => row.original);
      onSelectionChange(selectedRowIds, selectedRows);
    }
  }, [rowSelection, enableRowSelection, onSelectionChange, table]);

  // Get all rows from table
  const allRows = table.getRowModel().rows;
  
  // Get paginated rows (calculate directly, no memoization needed for simple slice)
  const start = currentPage * pageSize;
  const paginatedRows = allRows.slice(start, start + pageSize);
  
  const totalRows = allRows.length;
  const totalPages = Math.ceil(totalRows / pageSize);

  // Get selected rows for bulk actions toolbar
  const selectedRowModel = enableRowSelection ? table.getSelectedRowModel() : null;
  const selectedRowIds = selectedRowModel?.rows.map(row => row.id) || [];
  const selectedRows = selectedRowModel?.rows.map(row => row.original) || [];
  const hasSelectedRows = enableRowSelection && (table.getIsSomeRowsSelected() || table.getIsAllRowsSelected());
  
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    setCurrentPage(0);
  }, [columnFilters]);

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
            <DownloadIcon size={16} className="me-1" style={{ verticalAlign: 'middle' }} />
            Download CSV
          </Button>
        </div>}
        {!showSearch && totalRows > 0 && (
          <div className="mb-3 d-flex justify-content-end">
            <Button onClick={handleDownloadCSV} className="flex-shrink-0" color="secondary">
              <DownloadIcon size={16} className="me-1" style={{ verticalAlign: 'middle' }} />
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
				<TableHeader 
                  headers={table.getHeaderGroups()} 
                  flexRender={flexRender} 
                  enableRowSelection={enableRowSelection} 
                  table={table}
                  bulkActionsToolbar={bulkActionsToolbar}
                  hasSelectedRows={hasSelectedRows}
                  selectedRowIds={selectedRowIds}
                  selectedRows={selectedRows}
                />
                <TableBody
                  paginatedRows={paginatedRows}
                  columns={tableColumns}
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

interface TableHeaderProps<T> {
  headers: HeaderGroup<T>[];
  flexRender: <TProps extends object>(comp: any, props: TProps) => React.ReactNode;
  enableRowSelection?: boolean;
  table?: any;
  bulkActionsToolbar?: (selectedRowIds: string[], selectedRows: T[]) => React.ReactNode;
  hasSelectedRows?: boolean;
  selectedRowIds?: string[];
  selectedRows?: T[];
}

function TableHeader<T>({ headers, flexRender, enableRowSelection, table, bulkActionsToolbar, hasSelectedRows, selectedRowIds, selectedRows }: TableHeaderProps<T>) {
	const totalColumns = headers[0]?.headers.length || 0;
  const [openFilterInputs, setOpenFilterInputs] = useState<Record<string, boolean>>({});
	const showToolbar = bulkActionsToolbar && hasSelectedRows && selectedRowIds && selectedRows;
  const toFilterValue = (value: string) => (value === '' ? undefined : value);

  const openFilter = (columnId: string) => {
    setOpenFilterInputs((prev) => ({ ...prev, [columnId]: true }));
  };

  const clearAndCloseFilter = (header: any) => {
    setOpenFilterInputs((prev) => ({ ...prev, [header.id]: false }));
    header.column.setFilterValue(undefined);
  };

  const isHeaderFilterOpen = (header: any) => {
    const filterValue = header.column.getFilterValue();
    return Boolean(openFilterInputs[header.id]) || Boolean(filterValue);
  };
	return ( <thead>
		{headers.map((headerGroup) => (
		  <React.Fragment key={headerGroup.id}>
			<tr>
			  {headerGroup.headers.map((header) => {
				const isSelectColumn = enableRowSelection && header.id === 'select';
          const canFilter = header.column.getCanFilter() && !isSelectColumn && !header.isPlaceholder;
          const isFilterOpen = canFilter && isHeaderFilterOpen(header);
				return (
				  <th
					key={header.id}
					style={{
					  cursor: header.column.getCanSort() ? 'pointer' : 'default',
					  userSelect: 'none',
					}}
					onClick={isSelectColumn ? undefined : header.column.getToggleSortingHandler()}
				  >
					<div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center">
              {flexRender(header.column.columnDef.header, header.getContext())}
              {header.column.getCanSort() && !isSelectColumn && (
                <span className="ms-2">
                  {{
                    asc: ' ↑',
                    desc: ' ↓',
                  }[header.column.getIsSorted() as string] ?? ' ⇅'}
                </span>
              )}
            </div>
            {canFilter && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isFilterOpen) {
                    clearAndCloseFilter(header);
                  } else {
                    openFilter(header.id);
                  }
                }}
                aria-label={isFilterOpen ? `Clear filter for ${header.id}` : `Filter ${header.id}`}
                className="btn btn-link p-0 ms-2 text-muted"
                style={{ lineHeight: 1 }}
              >
                {isFilterOpen ? <FunnelXIcon /> : <FunnelIcon />}
              </button>
            )}
          </div>
          {canFilter && isFilterOpen && (
            <Input
              type="search"
              value={String(header.column.getFilterValue() ?? '')}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => header.column.setFilterValue(toFilterValue(e.target.value))}
              placeholder="Filter..."
              bsSize="sm"
              className="mt-1"
            />
          )}
				  </th>
				);
			  })}
			</tr>
			{bulkActionsToolbar ? (
			  <tr className={`bulk-actions-toolbar-row ${showToolbar ? 'open' : ''}`}>
				<td colSpan={totalColumns} style={{ backgroundColor: '#f8f9fa' }}>
				  <div className="d-flex align-items-center bulk-actions-toolbar-content" style={{ gap: '0.5rem' }}>
					{showToolbar ? bulkActionsToolbar(selectedRowIds!, selectedRows!) : null}
				  </div>
				</td>
			  </tr>
			) : null}
		  </React.Fragment>
		))}
	  </thead>
	);
}

function FunnelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" />
    </svg>
  );
}

function FunnelXIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" />
      <path d="m16 9 5 5" />
      <path d="m21 9-5 5" />
    </svg>
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
					  const isSelectColumn = cell.column.id === 'select';
					  const rendered = flexRender(cell.column.columnDef.cell, cell.getContext());
					  return (
						<td 
						  key={cell.id}
						  onClick={isSelectColumn ? (e) => e.stopPropagation() : undefined}
						>
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
