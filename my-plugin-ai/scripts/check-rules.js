import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Get top rules by confidence
  const topRules = await prisma.recommendationRule.findMany({
    orderBy: { confidence: 'desc' },
    take: 20
  });
  
  console.log('TOP 20 RULES (by confidence)\n');
  topRules.forEach((r, i) => {
    let cart = [];
    try {
      cart = JSON.parse(r.cartProducts || '[]');
    } catch(e) {
      cart = [r.cartProducts];
    }
    console.log(`#${i+1}: Cart [${cart.join(', ')}]`);
    console.log(`    → Suggest: ${r.suggestProduct}`);
    console.log(`    Confidence: ${(r.confidence * 100).toFixed(1)}%, Support: ${r.support}\n`);
  });
  
  // Count products that appear most frequently in suggestions
  const allRules = await prisma.recommendationRule.findMany({
    select: { suggestProduct: true }
  });
  
  const productCount = {};
  allRules.forEach(r => {
    const id = r.suggestProduct;
    productCount[id] = (productCount[id] || 0) + 1;
  });
  
  const sorted = Object.entries(productCount).sort((a,b) => b[1] - a[1]).slice(0, 10);
  console.log('\n TOP 10 MOST SUGGESTED PRODUCTS \n');
  sorted.forEach(([id, count], i) => {
    console.log(`#${i+1}: ${id} (suggested ${count} times)`);
  });

  // Tìm các product trong cart rules phổ biến
  const cartRules = await prisma.recommendationRule.findMany({
    where: { cartSize: 1 },
    orderBy: { support: 'desc' },
    take: 10
  });
  
  console.log('\n\n TOP 10 CART-1 PRODUCTS (for testing) \n');
  cartRules.forEach((r, i) => {
    let cart = [];
    try {
      cart = JSON.parse(r.cartProducts || '[]');
    } catch(e) {
      cart = [r.cartProducts];
    }
    console.log(`#${i+1}: Add "${cart[0]}" to cart`);
    console.log(`    → Will suggest: ${r.suggestProduct}`);
    console.log(`    Support: ${r.support}, Confidence: ${(r.confidence * 100).toFixed(1)}%\n`);
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => {
    console.error(e);
    prisma.$disconnect();
  });
