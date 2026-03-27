import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
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
  Cell,
  Header,
} from '@tanstack/react-table';
import { Input, Table, Pagination, PaginationItem, PaginationLink, Card, CardBody, Button } from 'reactstrap';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DownloadIcon } from '@phosphor-icons/react';
import Spinner from './Spinner';
import './TableUsingAPI.css';
import { asDate } from '../../common/utils/miscutils';

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
  /**
   * Whether to include this column in the CSV export.
   * If not provided, defaults to true if there is a header.
   */
  includeInCSV?: boolean;
  /**
   * Set to true to hide this column in the table. Use-case: for a column that is csv-only.
   */
  hidden?: boolean;
  style?: React.CSSProperties;
  /** When set, filter UI and behaviour are specialised (e.g. categorical multi-select). */
  type?: 'date' | 'categorical' | 'boolean' | 'list' | 'number';
  /**
   * For type `categorical`: values present on each row (e.g. all tags). Used to build the option list and OR matching.
   * Default to: string? comma-separated list of values : array? as-is : set? as-is
   */
  categoricalValues?: (row: T) => string[];

  /**
   * Optional function to render a custom header cell (not including the th and gubbins)
   * If not provided, the default header string is rendered.
   */
  headerCell?: (header: Header<T, unknown>) => React.ReactNode;
  /** Optional class for `<th>` cells for this column. */
  headerClassName?: string;
  /** Optional class for `<td>` cells for this column. */
  cellClassName?: string;
};
/* convenience for typing columnDef as ExtendedColumnDef<any> */
export function isHidden(columnDef: ColumnDef<any>) {
  const extendedColumnDef = columnDef as ExtendedColumnDef<any>;
  return extendedColumnDef?.hidden;
}

/** OR filter: row matches if any selected value is present in getValues(row). Empty selection = no filter. */
export function categoricalOrRowFilter<T>(getValues: (row: T) => string[]): FilterFn<T> {
  return (row, _columnId, filterValue) => {
    const selected = filterValue as string[] | undefined;
    if (!selected?.length) return true;
    const rowVals = getValues(row.original);
    const set = new Set(rowVals);
    return selected.some((s) => set.has(s));
  };
}

function collectCategoricalOptions<T>(
  data: T[] | undefined,
  categoricalValues: (row: T) => string[]
): string[] {
  const out = new Set<string>();
  for (const row of data ?? []) {
    for (const v of categoricalValues(row)) {
      if (v) out.add(v);
    }
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function filterValueIsActive(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).length > 0;
}

function CategoricalColumnFilter<T>({
  header,
  table,
}: {
  header: Header<T, unknown>;
  table: { options: { data?: T[] } };
}) {
  const colDef = header.column.columnDef as ExtendedColumnDef<T>;
  const getVals = colDef.categoricalValues;
  const data = table.options.data;
  const options = getVals ? collectCategoricalOptions(data, getVals) : [];
  const selected = (header.column.getFilterValue() as string[] | undefined) ?? [];
  const toggle = (tag: string) => {
    const next = selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag];
    header.column.setFilterValue(next.length ? next : undefined);
  };
  return (
    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
      {options.length === 0 ? (
        <span className="text-muted small">No values in loaded rows</span>
      ) : (
        <div className="border rounded p-2 bg-body" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {options.map((tag, i) => (
            <div key={tag} className="form-check mb-1">
              <input
                type="checkbox"
                className="form-check-input"
                id={`cat-${header.id}-${i}`}
                checked={selected.includes(tag)}
                onChange={() => toggle(tag)}
              />
              <label className="form-check-label small" htmlFor={`cat-${header.id}-${i}`}>
                {tag}
              </label>
            </div>
          ))}
        </div>
      )}
      <div className="small text-muted mt-1">Match any selected (OR)</div>
    </div>
  );
}

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
  /**
   * Callback fired when the filtered (and sorted) row set changes. Use to sync dashboard or other UI
   * with the rows currently matching column filters and global search. Only used when enableInMemoryFiltering is true.
   */
  onFilteredRowsChange?: (rows: T[]) => void;
  /**
   * Freeze the first N table rows (counting from the top: header row(s) in thead, then body rows)
   * so they stay visible while scrolling. E.g. 1 = column header row only.
   */
  freezeRows?: number;
  /**
   * Freeze the first N columns so they stay visible while scrolling.
   */
  freezeColumns?: number;
  /**
   * Prefix used for the CSV export filename.
   */
  csvFilenamePrefix?: string;
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
  onFilteredRowsChange,
  freezeRows = 0,
  freezeColumns = 0,
  csvFilenamePrefix = 'table-export',
}: TableUsingAPIProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [serverQuery, setServerQuery] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [frozenColumnLeftOffsets, setFrozenColumnLeftOffsets] = useState<number[]>([]);
  const [frozenRowTopOffsets, setFrozenRowTopOffsets] = useState<number[]>([]);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  /** Latest table instance for effects; useReactTable's return is not stable enough for dependency arrays. */
  const tableRef = useRef<ReturnType<typeof useReactTable<T>> | null>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onFilteredRowsChangeRef = useRef(onFilteredRowsChange);
  onFilteredRowsChangeRef.current = onFilteredRowsChange;
  const frozenColumnCount = Math.max(0, Math.floor(freezeColumns));
  const frozenRowCount = Math.max(0, Math.floor(freezeRows));
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
    queryFn: () => {
      return loadData(serverQuery);
    },
	refetchInterval,
  });
  useEffect(() => {
    if (loadedData) onDataLoaded?.(loadedData);
  }, [loadedData, onDataLoaded]);
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
      return header !== '' && col.includeInCSV !== false;
    });

    // Get header row
    const headers = visibleColumns.map(col => {
      const header = typeof col.header === 'string' ? col.header : (col as any).id || '';
      return escapeCSVValue(header);
    });

    // Get data rows from all filtered/sorted rows
    const rows = allRows.map(row => {
      return visibleColumns.map(col => {
        const colType = (col as any).type;
        // Use csvValue if provided
        if ((col as ExtendedColumnDef<T>).csvValue) {
          const value = (col as ExtendedColumnDef<T>).csvValue!(row.original);
          return escapeCSVValue(formatForCSV(value, colType));
        }
        
        // Try accessorFn (may not exist on all ColumnDef variants)
        const accessorFn = (col as any).accessorFn;
        if (accessorFn) {
          const value = accessorFn(row.original, row.index);
          return escapeCSVValue(formatForCSV(value, colType));
        }
        
        // Try accessorKey (may not exist on all ColumnDef variants)
        const accessorKey = (col as any).accessorKey;
        if (accessorKey) {
          const value = (row.original as any)[accessorKey];
          return escapeCSVValue(formatForCSV(value, colType));
        }
        
        // Fallback: try to get value by column id
        const colId = (col as any).id;
        if (colId) {
          const value = (row.original as any)[colId];
          return escapeCSVValue(formatForCSV(value, colType));
        }
        
        return '';
      });
    });

    // Combine headers and rows
    const csvRows = [headers, ...rows];
    return csvRows.map(row => row.join(',')).join('\n');
  };

  // format eg dates
  const formatForCSV = (value: any, type: string): string => {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (type === 'date') {
      return asDate(value)?.toISOString().split('T')[0] || '';
    }
    return String(value);
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
    link.setAttribute('download', `${csvFilenamePrefix}-${new Date().toISOString().split('T')[0]}.csv`);
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

  tableRef.current = table;

  // Handle selection changes - use table's selected row model for accurate data
  useEffect(() => {
    const cb = onSelectionChangeRef.current;
    if (!enableRowSelection || !cb) return;
    const selectedRowModel = tableRef.current!.getSelectedRowModel();
    const selectedRowIds = selectedRowModel.rows.map((row) => row.id);
    const selectedRows = selectedRowModel.rows.map((row) => row.original);
    cb(selectedRowIds, selectedRows);
  }, [rowSelection, enableRowSelection]);

  // Notify parent when filtered (and sorted) rows change, so dashboard can show stats for visible rows only
  useEffect(() => {
    const cb = onFilteredRowsChangeRef.current;
    if (!enableInMemoryFiltering || !cb) return;
    const rows = tableRef.current!.getRowModel().rows.map((r) => r.original);
    cb(rows);
  }, [hits, columnFilters, globalFilter, sorting, enableInMemoryFiltering]);

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

  const headerGroups = table.getHeaderGroups();
  /** Matches DOM: one tr per header group plus one optional bulk toolbar tr per group. */
  const theadRowCount = headerGroups.length + (bulkActionsToolbar ? headerGroups.length : 0);
  
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

  useLayoutEffect(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;
    if (frozenColumnCount === 0 && frozenRowCount === 0) {
      setFrozenColumnLeftOffsets((prev) => (prev.length === 0 ? prev : []));
      setFrozenRowTopOffsets((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const sameOffsets = (a: number[], b: number[]) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    };

    const updateFreezeOffsets = () => {
      const headerCells = Array.from(wrapper.querySelectorAll('thead tr:first-child th')) as HTMLElement[];
      const theadRows = Array.from(wrapper.querySelectorAll('thead tr')) as HTMLElement[];
      const bodyRows = Array.from(wrapper.querySelectorAll('tbody tr')) as HTMLElement[];
      /** Top-to-bottom order: thead rows (header, bulk toolbar, …) then body rows. */
      const rowsTopToBottom = [...theadRows, ...bodyRows];

      const visibleHeaderCells = headerCells.filter((cell) => cell.offsetParent !== null);
      const colOffsets: number[] = [];
      let colLeft = 0;
      for (let i = 0; i < Math.min(frozenColumnCount, visibleHeaderCells.length); i += 1) {
        colOffsets.push(colLeft);
        colLeft += visibleHeaderCells[i].getBoundingClientRect().width;
      }

      const rowOffsets: number[] = [];
      let rowTop = 0;
      for (let i = 0; i < Math.min(frozenRowCount, rowsTopToBottom.length); i += 1) {
        rowOffsets.push(rowTop);
        rowTop += rowsTopToBottom[i].getBoundingClientRect().height;
      }

      setFrozenColumnLeftOffsets((prev) => (sameOffsets(prev, colOffsets) ? prev : colOffsets));
      setFrozenRowTopOffsets((prev) => (sameOffsets(prev, rowOffsets) ? prev : rowOffsets));
    };

    updateFreezeOffsets();
    const resizeObserver = new ResizeObserver(updateFreezeOffsets);
    resizeObserver.observe(wrapper);
    window.addEventListener('resize', updateFreezeOffsets);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateFreezeOffsets);
    };
  }, [frozenColumnCount, frozenRowCount, currentPage, totalRows, tableColumns, bulkActionsToolbar]);

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
            <div
              ref={tableWrapperRef}
              className={`table-scroll-wrap ${(freezeRows > 0 || freezeColumns > 0) ? 'table-scroll-wrap-frozen' : ''}`}
            >
            <Table
              hover
              /* table-responsive adds overflow-x:auto; sticky cells then anchor to that wrapper,
                 which does not vertically scroll — only .table-scroll-wrap does. */
              responsive={frozenRowCount === 0 && frozenColumnCount === 0}
            >
				<TableHeader 
                  headers={headerGroups} 
                  flexRender={flexRender} 
                  enableRowSelection={enableRowSelection} 
                  table={table}
                  bulkActionsToolbar={bulkActionsToolbar}
                  hasSelectedRows={hasSelectedRows}
                  selectedRowIds={selectedRowIds}
                  selectedRows={selectedRows}
                  freezeRows={freezeRows}
                  freezeColumns={freezeColumns}
                  frozenColumnLeftOffsets={frozenColumnLeftOffsets}
                  frozenRowTopOffsets={frozenRowTopOffsets}
                />
                <TableBody
                  paginatedRows={paginatedRows}
                  columns={tableColumns}
                  totalRows={totalRows}
                  flexRender={flexRender}
                  onRowClick={onRowClick}
                  freezeRows={freezeRows}
                  theadRowCount={theadRowCount}
                  freezeColumns={freezeColumns}
                  frozenColumnLeftOffsets={frozenColumnLeftOffsets}
                  frozenRowTopOffsets={frozenRowTopOffsets}
                />
            </Table>
            </div>

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
  freezeRows?: number;
  freezeColumns?: number;
  frozenColumnLeftOffsets?: number[];
  frozenRowTopOffsets?: number[];
}

function TableHeader<T>({
  headers,
  flexRender,
  enableRowSelection,
  table,
  bulkActionsToolbar,
  hasSelectedRows,
  selectedRowIds,
  selectedRows,
  freezeRows = 0,
  freezeColumns = 0,
  frozenColumnLeftOffsets = [],
  frozenRowTopOffsets = [],
}: TableHeaderProps<T>) {
	const totalColumns = headers[0]?.headers.length || 0;
  const [openFilterInputs, setOpenFilterInputs] = useState<Record<string, boolean>>({});
	const showToolbar = bulkActionsToolbar && hasSelectedRows && selectedRowIds && selectedRows;
  const toFilterValue = (value: string) => (value === '' ? undefined : value);
  const frozenColumnCount = Math.max(0, Math.floor(freezeColumns));
  const frozenRowCount = Math.max(0, Math.floor(freezeRows));

  const openFilter = (columnId: string) => {
    setOpenFilterInputs((prev) => ({ ...prev, [columnId]: true }));
  };

  const clearAndCloseFilter = (header: any) => {
    setOpenFilterInputs((prev) => ({ ...prev, [header.id]: false }));
    header.column.setFilterValue(undefined);
  };

  const isHeaderFilterOpen = (header: any) => {
    const filterValue = header.column.getFilterValue();
    return Boolean(openFilterInputs[header.id]) || filterValueIsActive(filterValue);
  };

  const headerCellStickyStyle = (visibleColumnIndex: number, rowIdx: number): React.CSSProperties => {
    const isFrozenColumn = visibleColumnIndex < frozenColumnCount;
    const isFrozenHeaderRow = rowIdx < frozenRowCount;
    if (!isFrozenColumn && !isFrozenHeaderRow) return {};
    const style: React.CSSProperties = {
      position: 'sticky',
      background: 'var(--bs-table-bg, #fff)',
    };
    if (isFrozenColumn) {
      style.left = frozenColumnLeftOffsets[visibleColumnIndex] ?? 0;
    }
    if (isFrozenHeaderRow) {
      style.top = frozenRowTopOffsets[rowIdx] ?? 0;
    }
    style.zIndex = isFrozenColumn && isFrozenHeaderRow ? 45 : isFrozenColumn ? 30 : 40;
    return style;
  };

  let theadRowIndex = 0;

  function Th({
    header,
    visibleColumnIndex,
    columnHeaderRowIndex,
  }: {
    header: Header<T, unknown>;
    visibleColumnIndex: number;
    columnHeaderRowIndex: number;
  }) {
    const isSelectColumn = enableRowSelection && header.id === 'select';
    const canFilter = header.column.getCanFilter() && !isSelectColumn && !header.isPlaceholder;
    const isFilterOpen = canFilter && isHeaderFilterOpen(header);
    const extCol = header.column.columnDef as ExtendedColumnDef<any>;
    const useCategoricalFilter =
      extCol.type === 'categorical' && extCol.categoricalValues && table;
    const frozenStyle = headerCellStickyStyle(visibleColumnIndex, columnHeaderRowIndex);
    return (
      <th
        className={extCol.headerClassName}
        style={{
          cursor: header.column.getCanSort() ? 'pointer' : 'default',
          userSelect: 'none',
          ...frozenStyle,
        }}
        onClick={isSelectColumn ? undefined : header.column.getToggleSortingHandler()}
      >
        <div className="d-flex align-items-center justify-content-between">
          <div className="d-flex align-items-center">
            {extCol.headerCell ? extCol.headerCell(header) : flexRender(extCol.header, header.getContext())}
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
        {canFilter &&
          isFilterOpen &&
          (useCategoricalFilter ? (
            <CategoricalColumnFilter header={header} table={table} />
          ) : (
            <Input
              type="search"
              value={String(header.column.getFilterValue() ?? '')}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => header.column.setFilterValue(toFilterValue(e.target.value))}
              placeholder="Filter..."
              bsSize="sm"
              className="mt-1"
            />
          ))}
      </th>
    );
  }

  return (
    <thead>
      {headers.map((headerGroup) => {
        const columnHeaderRowIndex = theadRowIndex;
        theadRowIndex += 1;
        return (
          <React.Fragment key={headerGroup.id}>
            <tr>
              {headerGroup.headers
                .filter((h) => !isHidden(h.column.columnDef))
                .map((header, visibleColumnIndex) => (
                  <Th
                    key={header.id}
                    header={header}
                    visibleColumnIndex={visibleColumnIndex}
                    columnHeaderRowIndex={columnHeaderRowIndex}
                  />
                ))}
            </tr>
            {bulkActionsToolbar
              ? (() => {
                  const bulkRowIndex = theadRowIndex;
                  theadRowIndex += 1;
                  const bulkSticky =
                    bulkRowIndex < frozenRowCount
                      ? {
                          position: 'sticky' as const,
                          top: frozenRowTopOffsets[bulkRowIndex] ?? 0,
                          zIndex: 40,
                        }
                      : {};
                  return (
                    <tr key={`bulk-${headerGroup.id}`} className={`bulk-actions-toolbar-row ${showToolbar ? 'open' : ''}`}>
                      <td colSpan={totalColumns} style={{ backgroundColor: '#f8f9fa', ...bulkSticky }}>
                        <div className="d-flex align-items-center bulk-actions-toolbar-content" style={{ gap: '0.5rem' }}>
                          {showToolbar ? bulkActionsToolbar(selectedRowIds!, selectedRows!) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })()
              : null}
          </React.Fragment>
        );
      })}
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

function TableBody<T>({
  paginatedRows,
  columns,
  totalRows,
  flexRender,
  onRowClick,
  freezeRows = 0,
  theadRowCount,
  freezeColumns = 0,
  frozenColumnLeftOffsets = [],
  frozenRowTopOffsets = [],
}: {
  paginatedRows: Row<T>[],
  columns: ColumnDef<T>[],
  totalRows: number,
  flexRender: <TProps extends object>(comp: any, props: TProps) => React.ReactNode,
  onRowClick?: (row: T) => void,
  freezeRows?: number,
  /** Number of `<tr>` nodes in thead (column header + optional bulk toolbar per group). */
  theadRowCount: number,
  freezeColumns?: number,
  frozenColumnLeftOffsets?: number[],
  frozenRowTopOffsets?: number[],
}) {
  const frozenRowCount = Math.max(0, Math.floor(freezeRows));
  const frozenColumnCount = Math.max(0, Math.floor(freezeColumns));
	return (
		<tbody>
			{paginatedRows.map((row, rowIndex) => {
				const cells = row.getVisibleCells();
        const globalRowIndex = theadRowCount + rowIndex;
        const isFrozenRow = globalRowIndex < frozenRowCount;
				return (
				  <tr 
					key={row.id}
					onClick={() => onRowClick?.(row.original)}
					style={onRowClick ? { cursor: 'pointer' } : undefined}
				  >
					{cells.map((cell, visibleColumnIndex) => (
              <TableCell
                key={cell.id}
                cell={cell}
                isFrozenRow={isFrozenRow}
                isFrozenColumn={visibleColumnIndex < frozenColumnCount}
                frozenTop={frozenRowTopOffsets[globalRowIndex]}
                frozenLeft={frozenColumnLeftOffsets[visibleColumnIndex]}
              />
            ))}
				  </tr>
				);
			})}
		</tbody>
	);
}

function TableCell<T>({
  cell,
  isFrozenRow = false,
  isFrozenColumn = false,
  frozenTop,
  frozenLeft,
}: {
  cell: Cell<T, any>,
  isFrozenRow?: boolean,
  isFrozenColumn?: boolean,
  frozenTop?: number,
  frozenLeft?: number,
}) {
    const isSelectColumn = cell.column.id === 'select';
    let rendered = flexRender(cell.column.columnDef.cell, cell.getContext());
    const columnDef = cell.column.columnDef as ExtendedColumnDef<any>;
    if (columnDef.hidden) return null;
    let style = columnDef.style;
    if (style && (style.maxWidth || style.maxHeight)) {
      rendered = <div style={style}>{rendered}</div>;
      style = undefined;
    }
    const stickyStyle: React.CSSProperties = {};
    if (isFrozenRow) {
      stickyStyle.position = 'sticky';
      stickyStyle.top = frozenTop ?? 0;
      stickyStyle.zIndex = 20;
      stickyStyle.background = 'var(--bs-table-bg, #fff)';
    }
    if (isFrozenColumn) {
      stickyStyle.position = 'sticky';
      stickyStyle.left = frozenLeft ?? 0;
      stickyStyle.zIndex = isFrozenRow ? 25 : 15;
      stickyStyle.background = 'var(--bs-table-bg, #fff)';
    }
    return (
    <td 
      key={cell.id}
      className={columnDef.cellClassName}
      onClick={isSelectColumn ? (e) => e.stopPropagation() : undefined}
      style={{ ...columnDef.style, ...stickyStyle }}
    >
      {rendered}
    </td>
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
