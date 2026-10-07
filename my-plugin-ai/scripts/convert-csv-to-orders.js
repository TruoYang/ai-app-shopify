import fs from 'fs';
import { parse } from 'csv-parse/sync';

// 1. Read CSV
console.log('📖 Reading CSV file...');
const csvData = fs.readFileSync('./data/data.csv', 'utf-8');
const records = parse(csvData, { columns: true });
console.log(`📊 Total rows: ${records.length}`);

// 2. Group by InvoiceNo
console.log('🔄 Grouping by InvoiceNo...');
const ordersMap = {};
let skippedCancelled = 0;

records.forEach(row => {
  const invoiceNo = row.InvoiceNo;
  
  // Skip cancelled orders (start with 'C')
  if (invoiceNo.startsWith('C')) {
    skippedCancelled++;
    return;
  }
  
  if (!ordersMap[invoiceNo]) {
    ordersMap[invoiceNo] = [];
  }
  ordersMap[invoiceNo].push(row.StockCode);
});

console.log(`⏭️  Skipped ${skippedCancelled} cancelled rows`);

// 3. Convert to Shopify API-like format
console.log('🔧 Converting format...');
const orders = Object.entries(ordersMap).map(([invoiceNo, products]) => ({
  lineItems: {
    edges: [...new Set(products)].map(stockCode => ({
      node: {
        product: {
          id: `gid://shopify/Product/${stockCode}`
        }
      }
    }))
  }
}));

// 4. Save to JSON file
fs.writeFileSync('./data/orders.json', JSON.stringify(orders, null, 2));

console.log('');
console.log('✅ DONE!');
console.log(`📦 Total orders: ${orders.length}`);
console.log(`💾 File saved: ./data/orders.json`);
