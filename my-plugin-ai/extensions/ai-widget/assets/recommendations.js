document.addEventListener('DOMContentLoaded', () => {
  // Shopify app proxy (shopify.app.toml [app_proxy]): same origin as the store,
  // forwarded by Shopify to whatever URL the app currently runs on.
  const PROXY_PATH = '/apps/ai/recommend';

  console.log('AI Widget started...');

  const widgetContainer = document.getElementById('ai-widget-container');
  const contentContainer = document.getElementById('ai-product-content');

  if (!widgetContainer || !contentContainer) {
    console.error('Widget containers not found!');
    return;
  }

  const setStatus = (message) => {
    contentContainer.innerHTML = `<p style="margin: 0; color: #666;">${message}</p>`;
    widgetContainer.style.display = 'block';
  };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const shopDomain = window.Shopify?.shop;
  if (!shopDomain) {
    console.error('Shopify.shop not available');
    setStatus('We could not identify this store yet.');
    return;
  }
  
  fetch('/cart.js')
    .then(res => res.json())
    .then(cart => {
      console.log('Cart:', cart);
      
      if (cart.item_count === 0) {
        setStatus('Add a product to your cart to see suggestions.');
        return;
      }

      const productIds = cart.items.map(item => item.product_id);
      const skus = cart.items.map(item => item.sku).filter(Boolean);
      
      console.log('Product IDs:', productIds);
      console.log('SKUs:', skus);

      const params = new URLSearchParams({ ids: productIds.join(','), skus: skus.join(',') });
      const apiUrl = `${PROXY_PATH}?${params}`;
      console.log('Fetching:', apiUrl);

      return fetch(apiUrl);
    })
    .then(res => {
      if (!res) return null;
      if (!res.ok) {
        console.error('API Error:', res.status);
        return res.json().then(data => {
          console.log('API Response:', data);
          return null;
        });
      }
      return res.json();
    })
    .then(data => {
      if (!data) {
        setStatus('Recommendations are temporarily unavailable.');
        return;
      }
      
      console.log('AI Response:', data);

      const recommendations = Array.isArray(data.products)
        ? data.products
        : data.product
          ? [{ product: data.product, confidence: data.confidence }]
          : [];

      if (recommendations.length > 0) {
        const html = recommendations.map((recommendation) => {
          const product = recommendation.product;
          const confidence = recommendation.confidence
            ? (recommendation.confidence * 100).toFixed(0)
            : '?';
          const productUrl = escapeHtml(product.url);

          return `
            <article style="display: flex; gap: 12px; align-items: center; width: 100%;">
              <img src="${escapeHtml(product.image || 'https://via.placeholder.com/60')}"
                   alt="${escapeHtml(product.title)}"
                   style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;"
                   onerror="this.src='https://via.placeholder.com/60'">
              <div style="flex-grow: 1;">
                <a href="${productUrl}" style="font-weight: bold; text-decoration: none; color: black;">
                  ${escapeHtml(product.title)}
                </a>
                <p style="margin: 0; color: #666;">${escapeHtml(product.price)} ${escapeHtml(product.currency)}</p>
                <small style="color: #999;">${confidence}% customers also bought</small>
              </div>
              <a href="${productUrl}"
                 style="padding: 8px 12px; background: black; color: white; text-decoration: none; border-radius: 4px;">
                View
              </a>
            </article>
          `;
        }).join('');

        contentContainer.innerHTML = html;
        widgetContainer.style.display = 'block';
        console.log('Widget displayed!');
      } else {
        console.log('ℹNo recommendation:', data.message);
        setStatus("Oops, we don't have any products to suggest right now.");
      }
    })
    .catch(err => {
      console.error('Widget Error:', err);
      setStatus('Recommendations are temporarily unavailable.');
    });
});
