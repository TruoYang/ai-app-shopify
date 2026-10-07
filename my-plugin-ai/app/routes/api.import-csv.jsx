import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import fs from "fs";
import path from "path";

export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    console.log("📂 Starting CSV import for shop:", shop);

    // Đọc file CSV
    const csvPath = path.join(process.cwd(), "data", "data.csv");
    
    if (!fs.existsSync(csvPath)) {
      return Response.json(
        { success: false, error: "File data.csv không tồn tại" },
        { status: 400 }
      );
    }

    const csvContent = fs.readFileSync(csvPath, "utf-8");
    const lines = csvContent.split("\n");
    
    // Skip header
    const dataLines = lines.slice(1).filter(line => line.trim());
    
    console.log(`📊 Total lines in CSV: ${dataLines.length}`);

    // Group by InvoiceNo (order ID)
    const ordersMap = new Map();
    
    for (const line of dataLines) {
      // Parse CSV line (handle commas in descriptions)
      const parts = parseCSVLine(line);
      if (parts.length < 7) continue;
      
      const [invoiceNo, stockCode, description, quantity, invoiceDate] = parts;
      
      // Skip cancelled orders (InvoiceNo starts with 'C')
      if (invoiceNo.startsWith('C')) continue;
      
      // Skip invalid quantities
      const qty = parseInt(quantity);
      if (isNaN(qty) || qty <= 0) continue;
      
      if (!ordersMap.has(invoiceNo)) {
        ordersMap.set(invoiceNo, {
          orderId: invoiceNo,
          productIds: new Set(),
          orderDate: parseDate(invoiceDate)
        });
      }
      
      ordersMap.get(invoiceNo).productIds.add(stockCode);
    }

    console.log(`📦 Unique orders found: ${ordersMap.size}`);

    // Xóa orders cũ của shop này (từ CSV import)
    await prisma.orderHistory.deleteMany({
      where: { 
        shop,
        source: "csv_import"
      }
    });

    // Chuẩn bị data để insert
    const ordersToInsert = [];
    for (const [orderId, orderData] of ordersMap) {
      const productIdsArray = Array.from(orderData.productIds);
      
      // Chỉ lấy orders có ít nhất 2 sản phẩm (để có thể học pattern)
      if (productIdsArray.length >= 2) {
        ordersToInsert.push({
          shop,
          orderId: `csv_${orderId}`, // Prefix để phân biệt với order thật
          productIds: JSON.stringify(productIdsArray),
          orderDate: orderData.orderDate,
          source: "csv_import"
        });
      }
    }

    console.log(`✅ Orders with 2+ products: ${ordersToInsert.length}`);

    // Batch insert (chia nhỏ để tránh timeout)
    const BATCH_SIZE = 1000;
    let inserted = 0;
    
    for (let i = 0; i < ordersToInsert.length; i += BATCH_SIZE) {
      const batch = ordersToInsert.slice(i, i + BATCH_SIZE);
      await prisma.orderHistory.createMany({ data: batch });
      inserted += batch.length;
      console.log(`  Inserted ${inserted}/${ordersToInsert.length}`);
    }

    // Đếm tổng orders trong database
    const totalOrders = await prisma.orderHistory.count({ where: { shop } });

    return Response.json({
      success: true,
      message: "Import CSV thành công!",
      stats: {
        csvLines: dataLines.length,
        uniqueOrders: ordersMap.size,
        ordersImported: ordersToInsert.length,
        totalOrdersInDb: totalOrders
      }
    });

  } catch (err) {
    console.error("❌ CSV Import Error:", err);
    return Response.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
};

// Helper: Parse CSV line (handle quoted fields)
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
}

// Helper: Parse date from CSV format
function parseDate(dateStr) {
  try {
    // Format: "12/1/2010 8:26"
    const [datePart, timePart] = dateStr.split(" ");
    const [month, day, year] = datePart.split("/");
    return new Date(year, month - 1, day);
  } catch {
    return new Date();
  }
}
