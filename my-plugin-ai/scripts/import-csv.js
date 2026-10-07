/**
 * Script import CSV into database
 * Run once to seed test data
 * 
 * Usage: node scripts/import-csv.js
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function importCSV() {
  console.log('Starting CSV import...\n');

  const csvPath = path.join(__dirname, '..', 'data', 'data.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.error('File not found:', csvPath);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').slice(1); // Skip header

  console.log(`Read ${lines.length.toLocaleString()} lines from CSV\n`);

  // Group by InvoiceNo to create orders
  const ordersMap = new Map();

  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Parse CSV: InvoiceNo,StockCode,Description,Quantity,InvoiceDate,UnitPrice,CustomerID,Country
    const parts = line.split(',');
    const invoiceNo = parts[0]?.trim();
    const stockCode = parts[1]?.trim();

    if (!invoiceNo || !stockCode) continue;
    if (invoiceNo.startsWith('C')) continue; // Skip cancelled orders

    if (!ordersMap.has(invoiceNo)) {
      ordersMap.set(invoiceNo, new Set());
    }
    ordersMap.get(invoiceNo).add(stockCode);
  }

  console.log(`Found ${ordersMap.size.toLocaleString()} unique orders\n`);

  // Filter orders with >= 2 products
  const validOrders = [];
  for (const [invoiceNo, products] of ordersMap) {
    if (products.size >= 2) {
      validOrders.push({
        orderId: `csv_${invoiceNo}`,
        shop: 'imported-from-csv',
        productIds: JSON.stringify([...products]),
      });
    }
  }

  console.log(`✅ Orders có 2+ products: ${validOrders.length.toLocaleString()}\n`);

  // Clear old imported data
  const deleted = await prisma.orderHistory.deleteMany({
    where: { shop: 'imported-from-csv' }
  });
  console.log(`Deleted ${deleted.count} old orders (imported previously)\n`);

  // Insert in batches (SQLite does not support skipDuplicates so we deleteMany first)
  const BATCH_SIZE = 500;
  let imported = 0;

  for (let i = 0; i < validOrders.length; i += BATCH_SIZE) {
    const batch = validOrders.slice(i, i + BATCH_SIZE);
    await prisma.orderHistory.createMany({
      data: batch,
    });
    imported += batch.length;
    console.log(`  Imported: ${imported.toLocaleString()} / ${validOrders.length.toLocaleString()}`);
  }

  // Count total
  const totalOrders = await prisma.orderHistory.count();

  console.log('\n' + '='.repeat(50));
  console.log('IMPORT COMPLETE!');
  console.log('='.repeat(50));
  console.log(`Orders imported: ${imported.toLocaleString()}`);
  console.log(`Total orders in DB: ${totalOrders.toLocaleString()}`);
  console.log('\nWe can now go to the app and click "Train AI Model"');
}

importCSV()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
