type RawLine = Record<string, unknown>;

export interface ProductLineMeta {
  productName: string | null;
  sku: string | null;
  category: string | null;
}

const pick = (item: RawLine, keys: string[]): string | null => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
};

const NAME_KEYS = ['productName', 'ProductName', 'product_name', 'itemName', 'ItemName', 'item_name', 'productTitle', 'title', 'description', 'Description'];
const SKU_KEYS = ['sku', 'SKU', 'productSKU', 'productSku', 'productCode', 'ProductCode', 'itemCode', 'ItemCode', 'barcode', 'Barcode'];
const CATEGORY_KEYS = [
  'category', 'Category', 'categoryName', 'CategoryName', 'category_name',
  'productCategory', 'ProductCategory', 'productCategoryName', 'itemCategory',
  'subCategory', 'SubCategory', 'subcategory', 'department', 'productType', 'group', 'groupName',
];

// Reads display-only product details from a raw ERP line item (never amounts/rates).
export const extractProductLineMeta = (item: RawLine): ProductLineMeta => ({
  productName: pick(item, NAME_KEYS),
  sku: pick(item, SKU_KEYS),
  category: pick(item, CATEGORY_KEYS),
});

const isPlaceholderName = (name: unknown): boolean =>
  typeof name !== 'string' || name.trim() === '' || /^(unknown product|product)$/i.test(name.trim());

const asLines = (value: unknown): RawLine[] =>
  Array.isArray(value) ? value.filter((v): v is RawLine => typeof v === 'object' && v !== null) : [];

// Fills missing display fields of stored product commission lines from the raw invoice line items.
// Amounts, quantities and rates stored by the existing commission calculation are never touched.
export const enrichProductBreakdown = (stored: unknown, rawLineItems: unknown): RawLine[] | null => {
  if (!Array.isArray(stored)) return null;
  const lines = asLines(stored);
  const raws = asLines(rawLineItems);
  if (raws.length === 0) return lines;

  return lines.map((line, index) => {
    const id = line.productID ?? line.productId;
    const raw =
      (id !== undefined && id !== null
        ? raws.find((r) => String(r.productID ?? r.productId ?? r.id) === String(id))
        : undefined) ?? raws[index];
    if (!raw) return line;
    const meta = extractProductLineMeta(raw);
    return {
      ...line,
      productName: isPlaceholderName(line.productName) && meta.productName ? meta.productName : line.productName,
      sku: line.sku ? line.sku : meta.sku,
      category: line.category ? line.category : meta.category,
    };
  });
};
