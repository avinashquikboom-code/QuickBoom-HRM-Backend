type RawLine = Record<string, unknown>;

export interface ProductLineMeta {
  productName: string | null;
  productId: string | number | null;
  numericProductId: number | null;
  sku: string | null;
  category: string | null;
  categoryId: number | null;
  rawCategoryId: string | null;
  variant: string | null;
}

const pick = (item: RawLine, keys: string[]): string | null => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
};

const pickNumber = (item: RawLine, keys: string[]): number | null => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = parseInt(value.trim(), 10);
      if (!isNaN(parsed) && String(parsed) === value.trim()) return parsed;
    }
  }
  return null;
};

const PRODUCT_ID_KEYS = ['productID', 'ProductID', 'productId', 'product_id', 'id', 'item_id', 'itemId'];
const NAME_KEYS = ['productName', 'ProductName', 'product_name', 'itemName', 'ItemName', 'item_name', 'productTitle', 'title', 'description', 'Description'];
const SKU_KEYS = ['sku', 'SKU', 'productSKU', 'productSku', 'productCode', 'ProductCode', 'itemCode', 'ItemCode', 'barcode', 'Barcode'];
const VARIANT_KEYS = ['variant', 'Variant', 'variantName', 'VariantName', 'variant_name'];
const CATEGORY_ID_KEYS = ['CategoryID', 'categoryId', 'category_id', 'CategoryId', 'catId', 'CatId', 'cat_id'];
const CATEGORY_KEYS = [
  'category', 'Category', 'categoryName', 'CategoryName', 'category_name',
  'productCategory', 'ProductCategory', 'productCategoryName', 'itemCategory',
  'subCategory', 'SubCategory', 'subcategory', 'department', 'productType', 'group', 'groupName',
  'CategoryID', 'categoryId', 'category_id', 'CategoryId'
];

// Reads product details including IDs and categories from raw ERP line item
export const extractProductLineMeta = (item: RawLine): ProductLineMeta => {
  const rawCatId = pick(item, CATEGORY_ID_KEYS);
  const numCatId = pickNumber(item, CATEGORY_ID_KEYS);
  const rawProdId = pick(item, PRODUCT_ID_KEYS);
  const numProdId = pickNumber(item, PRODUCT_ID_KEYS);

  return {
    productName: pick(item, NAME_KEYS),
    productId: rawProdId,
    numericProductId: numProdId,
    sku: pick(item, SKU_KEYS),
    category: pick(item, CATEGORY_KEYS),
    categoryId: numCatId,
    rawCategoryId: rawCatId,
    variant: pick(item, VARIANT_KEYS),
  };
};

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
      productID: line.productID ?? line.productId ?? meta.productId ?? id,
      productName: isPlaceholderName(line.productName) && meta.productName ? meta.productName : line.productName,
      sku: line.sku ? line.sku : meta.sku,
      category: line.category ? line.category : meta.category,
      categoryId: (line as any).categoryId ?? meta.categoryId,
      variant: line.variant ? line.variant : meta.variant,
    };
  });
};
