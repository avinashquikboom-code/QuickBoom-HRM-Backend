import { Request, Response } from 'express';
import { prisma } from '../utils/db';

/**
 * Get all available sizes strictly from database.
 */
export const getSizes = async (req: Request, res: Response): Promise<void> => {
  try {
    const sizes = await prisma.productSize.findMany({
      orderBy: { id: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: sizes.map((s) => s.name),
      fullDetails: sizes,
    });
  } catch (error: any) {
    console.error('Error fetching sizes:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch sizes' });
  }
};

/**
 * Add a new custom size dynamically (adds to master list & dropdown)
 */
export const addSize = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, category } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, message: 'Size name is required.' });
      return;
    }

    const trimmedName = name.trim();

    const existing = await prisma.productSize.findUnique({
      where: { name: trimmedName },
    });

    if (!existing) {
      await prisma.productSize.create({
        data: {
          name: trimmedName,
          category: category || 'General',
        },
      });
    }

    const allSizes = await prisma.productSize.findMany({
      orderBy: { id: 'asc' },
    });

    res.status(201).json({
      success: true,
      message: `Size '${trimmedName}' added successfully.`,
      addedSize: trimmedName,
      data: allSizes.map((s) => s.name),
    });
  } catch (error: any) {
    console.error('Error adding size:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to add size' });
  }
};

/**
 * Get all available colors strictly from database.
 */
export const getColors = async (req: Request, res: Response): Promise<void> => {
  try {
    const colors = await prisma.productColor.findMany({
      orderBy: { id: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: colors.map((c) => c.name),
      fullDetails: colors,
    });
  } catch (error: any) {
    console.error('Error fetching colors:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch colors' });
  }
};

/**
 * Add a new custom color dynamically (adds to master list & dropdown)
 */
export const addColor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, hexCode } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, message: 'Color name is required.' });
      return;
    }

    const trimmedName = name.trim();

    const existing = await prisma.productColor.findUnique({
      where: { name: trimmedName },
    });

    if (!existing) {
      await prisma.productColor.create({
        data: {
          name: trimmedName,
          hexCode: hexCode || '#000000',
        },
      });
    }

    const allColors = await prisma.productColor.findMany({
      orderBy: { id: 'asc' },
    });

    res.status(201).json({
      success: true,
      message: `Color '${trimmedName}' added successfully.`,
      addedColor: trimmedName,
      data: allColors.map((c) => c.name),
    });
  } catch (error: any) {
    console.error('Error adding color:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to add color' });
  }
};

/**
 * Get list of products
 */
export const getProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error: any) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch products' });
  }
};

/**
 * Create a new product
 */
export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      sku,
      description,
      category,
      brand,
      price,
      mrp,
      costPrice,
      hsnCode,
      gstRate,
      sizes,
      colors,
      imageUrl,
      stockQuantity,
    } = req.body;

    if (!name || price === undefined || isNaN(Number(price))) {
      res.status(400).json({ success: false, message: 'Product name and valid price are required.' });
      return;
    }

    // Generate SKU if missing
    const generatedSku = sku ? sku.trim() : `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const product = await prisma.product.create({
      data: {
        name: name.trim(),
        sku: generatedSku,
        description: description || null,
        category: category || 'General',
        brand: brand || 'HopKid',
        price: parseFloat(price),
        mrp: mrp ? parseFloat(mrp) : parseFloat(price) * 1.2,
        costPrice: costPrice ? parseFloat(costPrice) : null,
        hsnCode: hsnCode || '6204',
        gstRate: gstRate !== undefined ? parseFloat(gstRate) : 18.0,
        sizes: Array.isArray(sizes) ? sizes : [],
        colors: Array.isArray(colors) ? colors : [],
        imageUrl: imageUrl || null,
        stockQuantity: stockQuantity !== undefined ? parseInt(stockQuantity, 10) : 100,
        isActive: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      data: product,
    });
  } catch (error: any) {
    console.error('Error creating product:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create product' });
  }
};

/**
 * Update existing product
 */
export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = String(req.params.id);
    const productId = parseInt(idParam, 10);

    if (isNaN(productId)) {
      res.status(400).json({ success: false, message: 'Invalid product ID.' });
      return;
    }

    const {
      name,
      sku,
      description,
      category,
      brand,
      price,
      mrp,
      costPrice,
      hsnCode,
      gstRate,
      sizes,
      colors,
      imageUrl,
      stockQuantity,
      isActive,
    } = req.body;

    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Product not found.' });
      return;
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        name: name !== undefined ? name.trim() : existing.name,
        sku: sku !== undefined ? sku.trim() : existing.sku,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        brand: brand !== undefined ? brand : existing.brand,
        price: price !== undefined ? parseFloat(price) : existing.price,
        mrp: mrp !== undefined ? parseFloat(mrp) : existing.mrp,
        costPrice: costPrice !== undefined ? parseFloat(costPrice) : existing.costPrice,
        hsnCode: hsnCode !== undefined ? hsnCode : existing.hsnCode,
        gstRate: gstRate !== undefined ? parseFloat(gstRate) : existing.gstRate,
        sizes: Array.isArray(sizes) ? sizes : existing.sizes,
        colors: Array.isArray(colors) ? colors : existing.colors,
        imageUrl: imageUrl !== undefined ? imageUrl : existing.imageUrl,
        stockQuantity: stockQuantity !== undefined ? parseInt(stockQuantity, 10) : existing.stockQuantity,
        isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Product updated successfully.',
      data: updated,
    });
  } catch (error: any) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update product' });
  }
};

/**
 * Delete product
 */
export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = String(req.params.id);
    const productId = parseInt(idParam, 10);

    if (isNaN(productId)) {
      res.status(400).json({ success: false, message: 'Invalid product ID.' });
      return;
    }

    await prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully.',
    });
  } catch (error: any) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete product' });
  }
};
