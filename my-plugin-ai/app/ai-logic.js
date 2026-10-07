// app/ai-logic.js

/**
 * Train model from database orders
 * Input: Array of { productIds: JSON string }
 * Output: Rules array for database
 */

// Train from DB
export function trainModelFromDb(dbOrders, shop, options = {}) {
    const {
        minConfidence = 0.1,      // Confidence at least 0.1 = 10%
        minSupport = 3,           // Minimum number of occurrences
        maxItemsPerOrder = 15     // Skip orders with too many items
    } = options;

    console.log('Training from database...');
    console.log(`Total orders: ${dbOrders.length}`);

    // Count occurrences of itemsets
    const itemsetCount = new Map();
    let processedOrders = 0;

    for (const order of dbOrders) {
        let items;
        try {
            items = JSON.parse(order.productIds);
        } catch {
            continue;
        }

        // Ensure unique and sorted
        items = [...new Set(items)].sort();

        // Skip orders with too few or too many items
        if (items.length < 2 || items.length > maxItemsPerOrder) continue;
        
        processedOrders++;

        // Single items
        items.forEach(item => {
            itemsetCount.set(item, (itemsetCount.get(item) || 0) + 1);
        });

        // Pairs (2 items)
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const key = `${items[i]}|||${items[j]}`;
                itemsetCount.set(key, (itemsetCount.get(key) || 0) + 1);
            }
        }

        // Triples (3 items)
        if (items.length >= 3) {
            for (let i = 0; i < items.length; i++) {
                for (let j = i + 1; j < items.length; j++) {
                    for (let k = j + 1; k < items.length; k++) {
                        const key = `${items[i]}|||${items[j]}|||${items[k]}`;
                        itemsetCount.set(key, (itemsetCount.get(key) || 0) + 1);
                    }
                }
            }
        }
    }

    console.log(`   Processed orders: ${processedOrders}`);
    console.log(`   Itemsets: ${itemsetCount.size}`);

    // Create rules
    const rules = [];

    itemsetCount.forEach((support, key) => {
        const items = key.split('|||');
        
        if (items.length < 2) return;
        if (support < minSupport) return;

        // Try each item as a suggestion
        items.forEach((suggestItem, idx) => {
            const cartItems = items.filter((_, i) => i !== idx);
            const cartKey = cartItems.join('|||');
            const cartSupport = itemsetCount.get(cartKey) || 0;

            if (cartSupport === 0) return;

            const confidence = support / cartSupport;

            if (confidence >= minConfidence) {
                rules.push({
                    shop,
                    cartProducts: JSON.stringify(cartItems),
                    cartSize: cartItems.length,
                    suggestProduct: suggestItem,
                    confidence: Math.round(confidence * 1000) / 1000,
                    support: support
                });
            }
        });
    });

    console.log(`   Raw rules: ${rules.length}`);

    // Remove duplicates and sort
    const uniqueRules = [];
    const seen = new Set();
    
    rules.sort((a, b) => {
        if (b.support !== a.support) return b.support - a.support;
        return b.confidence - a.confidence;
    });

    for (const rule of rules) {
        const key = `${rule.cartProducts}|${rule.suggestProduct}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueRules.push(rule);
        }
    }

    console.log(`   Final rules: ${uniqueRules.length}`);
    return uniqueRules;
}

/**
 * Train model to suggest products based on cart contents
 * Input: Cart with [A, B] → Output: Suggest C
 */
// Train from orders array
export function trainModel(orders, options = {}) {
    const {
        minConfidence = 0.3,      // Minimum confidence (30%)
        minSupport = 5,           // Minimum number of occurrences
        maxCartSize = 2,          // Maximum cart size (2 = pairs)
        maxItemsPerOrder = 10     // Skip orders with too many items
    } = options;

    console.log('   Step 1: Count itemsets...');
    
    // Count occurrences of itemsets
    const itemsetCount = new Map();

    // 1. Iterate through orders and count itemsets
    let processedOrders = 0;
    orders.forEach(order => {
        const items = [...new Set(
            order.lineItems.edges
                .map(edge => edge.node.product?.id)
                .filter(id => id)
        )].sort();

        // Skip orders with too many items (avoid explosion)
        if (items.length > maxItemsPerOrder || items.length < 2) return;
        
        processedOrders++;

        // Only create small subsets (1, 2, 3 items)
        // Single items
        items.forEach(item => {
            const key = item;
            itemsetCount.set(key, (itemsetCount.get(key) || 0) + 1);
        });

        // Pairs (2 items)
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const key = `${items[i]},${items[j]}`;
                itemsetCount.set(key, (itemsetCount.get(key) || 0) + 1);
            }
        }

        // Triples (3 items) - only when maxCartSize >= 2
        if (maxCartSize >= 2 && items.length >= 3) {
            for (let i = 0; i < items.length; i++) {
                for (let j = i + 1; j < items.length; j++) {
                    for (let k = j + 1; k < items.length; k++) {
                        const key = `${items[i]},${items[j]},${items[k]}`;
                        itemsetCount.set(key, (itemsetCount.get(key) || 0) + 1);
                    }
                }
            }
        }
    });

    console.log(`   Processed ${processedOrders} orders`);
    console.log(`   Itemsets count: ${itemsetCount.size}`);
    console.log('   Step 2: Create rules...');

    // 2. Create rules: {cart: [A, B]} → {suggest: C}
    const rules = [];

    itemsetCount.forEach((support, key) => {
        const items = key.split(',');
        
        // Only consider itemsets with >= 2 items
        if (items.length < 2) return;
        if (support < minSupport) return;

        // Try each item as a suggestion
        items.forEach((suggestItem, idx) => {
            const cartItems = items.filter((_, i) => i !== idx);
            const cartKey = cartItems.join(',');
            const cartSupport = itemsetCount.get(cartKey) || 0;

            if (cartSupport === 0) return;

            const confidence = support / cartSupport;

            if (confidence >= minConfidence) {
                rules.push({
                    cart: cartItems,
                    cartSize: cartItems.length,
                    suggest: suggestItem,
                    confidence: confidence,
                    support: support,
                    cartSupport: cartSupport
                });
            }
        });
    });

    console.log(`   Raw rules: ${rules.length}`);

    // 3. Sort and remove duplicates
    rules.sort((a, b) => {
        if (b.cartSize !== a.cartSize) return b.cartSize - a.cartSize;
        if (b.support !== a.support) return b.support - a.support;
        return b.confidence - a.confidence;
    });

    const uniqueRules = [];
    const seen = new Set();
    rules.forEach(rule => {
        const key = `${rule.cart.join(',')}|${rule.suggest}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueRules.push(rule);
        }
    });

    console.log(`   Unique rules: ${uniqueRules.length}`);
    return uniqueRules;
}

// Recommend products based on cart contents
export function getRecommendations(cartProductIds, rules, limit = 3) {
    const cart = [...cartProductIds].sort();
    const cartSet = new Set(cart);
    
    const recommendations = [];

    for (const rule of rules) {
        const isMatch = rule.cart.every(item => cartSet.has(item));

        if (isMatch && !cartSet.has(rule.suggest)) {
            recommendations.push({
                productId: rule.suggest,
                confidence: rule.confidence,
                basedOn: rule.cart
            });

            if (recommendations.length >= limit) break;
        }
    }

    return recommendations;
}