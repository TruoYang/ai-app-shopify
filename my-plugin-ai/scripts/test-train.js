import fs from 'fs';
import { trainModel, getRecommendations } from '../app/ai-logic.js';


console.log('Đang đọc orders.json...');
const ordersData = fs.readFileSync('./data/orders.json', 'utf-8');
const orders = JSON.parse(ordersData);
console.log(`Tổng số orders: ${orders.length}`);

console.log('Đang train model...');
const startTime = Date.now();
const rules = trainModel(orders, {
  minConfidence: 0.3,
  minSupport: 5,
  maxCartSize: 3
});
const endTime = Date.now();

console.log('');
console.log('TRAINING HOÀN THÀNH!');
console.log(`Thời gian: ${(endTime - startTime) / 1000}s`);
console.log(`Số rules: ${rules.length}`);

// 4. Hiển thị rules theo loại
const rules1to1 = rules.filter(r => r.cartSize === 1);
const rules2to1 = rules.filter(r => r.cartSize === 2);
const rules3to1 = rules.filter(r => r.cartSize === 3);

console.log(`   - Cart 1 sản phẩm → Gợi ý 1: ${rules1to1.length} rules`);
console.log(`   - Cart 2 sản phẩm → Gợi ý 1: ${rules2to1.length} rules`);
console.log(`   - Cart 3 sản phẩm → Gợi ý 1: ${rules3to1.length} rules`);

console.log('\n' + '═'.repeat(80));
console.log('📋 VÍ DỤ RULES (Cart 2 → Gợi ý 1):');
console.log('═'.repeat(80));
rules2to1.slice(0, 10).forEach((rule, i) => {
  console.log(`\n${i + 1}. Giỏ hàng: [${rule.cart.join(', ')}]`);
  console.log(`   → Gợi ý: ${rule.suggest}`);
  console.log(`   → Confidence: ${(rule.confidence * 100).toFixed(1)}%`);
  console.log(`   → Xuất hiện: ${rule.support} orders`);
});

// 6. Test getRecommendations
console.log('\n' + '═'.repeat(80));
console.log('🧪 TEST: Gợi ý cho giỏ hàng cụ thể');
console.log('═'.repeat(80));

// Lấy 1 rule làm test case
if (rules2to1.length > 0) {
  const testCart = rules2to1[0].cart;
  console.log(`\n🛒 Giỏ hàng: [${testCart.join(', ')}]`);
  
  const recommendations = getRecommendations(testCart, rules, 3);
  console.log('💡 Gợi ý:');
  recommendations.forEach((rec, i) => {
    console.log(`   ${i + 1}. ${rec.productId} (${(rec.confidence * 100).toFixed(1)}%)`);
  });
}

// 7. Lưu rules
fs.writeFileSync('./data/trained-rules.json', JSON.stringify(rules, null, 2));
console.log('\n' + '═'.repeat(80));
console.log(`💾 Rules saved: ./data/trained-rules.json`);
