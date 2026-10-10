document.addEventListener('DOMContentLoaded', () => {
  // Production URL
  const PRODUCTION_URL = "https://my-plugin-ai.onrender.com";
  
  // Dev URL - set null to use production
  let DEV_URL = null;
  // Uncomment and update when testing locally:
  DEV_URL = 'https://ted-obviously-computed-freedom.trycloudflare.com';
  
  const APP_URL = DEV_URL || PRODUCTION_URL;

  console.log('AI Widget started...');
  console.log('Using API:', APP_URL);

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

      const apiUrl = `${APP_URL}/api/recommend?shop=${shopDomain}&ids=${productIds.join(',')}&skus=${skus.join(',')}`;
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

      if (data.product) {
        const p = data.product;
        const confidence = data.confidence ? (data.confidence * 100).toFixed(0) : '?';
        
        const html = `
          <img src="${p.image || 'https://via.placeholder.com/60'}" 
               style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;"
               onerror="this.src='https://via.placeholder.com/60'">
          <div style="flex-grow: 1;">
            <a href="${p.url}" style="font-weight: bold; text-decoration: none; color: black;">
              ${p.title}
            </a>
            <p style="margin: 0; color: #666;">${p.price} ${p.currency}</p>
            <small style="color: #999;">${confidence}% customers also bought</small>
          </div>
          <button onclick="window.location.href='${p.url}'" 
                  style="padding: 8px 12px; background: black; color: white; border: none; cursor: pointer; border-radius: 4px;">
            View
          </button>
        `;

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
