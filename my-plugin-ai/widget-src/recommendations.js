// Source of the storefront widget. Edit this file, then run "npm run build:widget" to write the
// minified copy to extensions/ai-widget/assets/recommendations.js (app block JS must stay under 10 KB).

// SmartCart RCM storefront widget.
//
// - Calls the app through the Shopify app proxy (/apps/ai/recommend), same origin as the store.
// - Renders the last result for the same cart instantly from sessionStorage, then refreshes.
// - Keeps up to KEEP_PREVIOUS earlier suggestions when the cart changes (A -> B, then
//   adding C shows D and still B), unless they are now in the cart.
// - Add to cart dispatches Shopify's standard CartLinesUpdateEvent when the theme
//   supports it (Horizon), so the cart drawer and cart count update in place.

(() => {
  const PROXY_PATH = '/apps/ai/recommend';
  const CACHE_KEY = 'smartcart-rcm:v2';
  const KEEP_PREVIOUS = 2;
  const MAX_CACHED_CARTS = 20;
  const SIZE_KEY = 'smartcart-rcm:card-size';
  const SIZES = ['small', 'medium', 'large'];
  const BUNDLE_SIZE = 3;

  const readCache = () => {
    try {
      return JSON.parse(sessionStorage.getItem(CACHE_KEY)) || { byCart: {}, lastShown: [] };
    } catch {
      return { byCart: {}, lastShown: [] };
    }
  };

  const writeCache = (cache) => {
    try {
      const keys = Object.keys(cache.byCart);
      keys.slice(0, Math.max(0, keys.length - MAX_CACHED_CARTS)).forEach((key) => delete cache.byCart[key]);
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Storage full or disabled: the widget still works without the cache.
    }
  };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const imageUrl = (url, width) => {
    if (!url) return '';
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}width=${width}`;
  };

  const numericId = (gid) => String(gid ?? '').split('/').pop();

  // Shopify's standard storefront events, exposed by themes such as Horizon through an import map.
  let eventsModule;
  const loadEvents = () => {
    if (eventsModule === undefined) {
      eventsModule = import('@shopify/events').catch(() => null);
    }
    return eventsModule;
  };

  const fetchCart = () => fetch('/cart.js', { headers: { Accept: 'application/json' } }).then((res) => res.json());

  class Widget {
    constructor(root) {
      this.root = root;
      this.grid = root.querySelector('.smartcart-rcm__grid');
      this.footer = root.querySelector('.smartcart-rcm__footer');
      this.max = Number(root.dataset.maxProducts) || 4;
      this.showAddToCart = root.dataset.showAddToCart !== 'false';
      this.contextSku = root.dataset.contextSku || '';
      this.formatter = new Intl.NumberFormat(root.dataset.locale || undefined, {
        style: 'currency',
        currency: root.dataset.currency || 'USD',
      });
      this.root.addEventListener('click', (event) => this.onClick(event));
      this.setupSizeSwitch();
    }

    // Shopper's card size (remembered in this browser), else the merchant's default.
    setupSizeSwitch() {
      let saved = null;
      try {
        saved = localStorage.getItem(SIZE_KEY);
      } catch {
        // Storage disabled: keep the default size.
      }
      this.applySize(SIZES.includes(saved) ? saved : this.root.dataset.size);
      this.root.querySelectorAll('[data-size-option]').forEach((button) => {
        button.addEventListener('click', () => {
          const size = button.dataset.sizeOption;
          this.applySize(size);
          try {
            localStorage.setItem(SIZE_KEY, size);
          } catch {
            // Not remembered, still applied.
          }
        });
      });
    }

    applySize(size) {
      const value = SIZES.includes(size) ? size : 'medium';
      this.root.dataset.size = value;
      this.root.querySelectorAll('[data-size-option]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.sizeOption === value));
      });
    }

    async refresh() {
      const cart = await fetchCart().catch(() => null);
      if (!cart) return;

      const skus = [this.contextSku, ...cart.items.map((item) => item.sku)].filter(Boolean);
      const signature = [...new Set(skus)].sort().join(',');
      const cache = readCache();

      // Instant render from the last result for this exact cart; only an empty widget shows
      // the loading state, so a page refresh does not dim suggestions that are already there.
      if (cache.byCart[signature]) this.render(cache.byCart[signature]);
      else this.root.classList.add('smartcart-rcm--loading');

      try {
        const params = new URLSearchParams({ skus: [...new Set(skus)].join(',') });
        const response = await fetch(`${PROXY_PATH}?${params}`, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const fresh = Array.isArray(data.products) ? data.products : [];
        const inCart = new Set(data.cartKeys || []);
        const freshKeys = new Set(fresh.map((entry) => entry.product.sku));

        // Keep a few earlier suggestions that are still relevant.
        const kept = (cache.lastShown || [])
          .filter((entry) => !freshKeys.has(entry.product.sku) && !inCart.has(entry.product.sku))
          .slice(0, KEEP_PREVIOUS);
        const merged = [...fresh.slice(0, this.max - kept.length), ...kept].slice(0, this.max);

        cache.byCart[signature] = merged;
        cache.lastShown = merged;
        writeCache(cache);
        this.render(merged);
      } catch (error) {
        console.warn('SmartCart RCM: could not load recommendations', error);
      } finally {
        this.root.classList.remove('smartcart-rcm--loading');
      }
    }

    render(entries) {
      if (!entries.length) {
        this.root.hidden = true;
        return;
      }
      const text = this.root.dataset;
      const shown = entries.slice(0, this.max);
      this.grid.innerHTML = shown.map((entry) => {
        const { product } = entry;
        const price = Number(product.price);
        const compareAt = Number(product.compareAtPrice);
        const discount = compareAt > price ? Math.round((1 - price / compareAt) * 100) : 0;
        const url = escapeHtml(product.url);
        const reason = this.reason(entry);
        const image = product.image
          ? `<img src="${escapeHtml(imageUrl(product.image, 480))}" alt="${escapeHtml(product.title)}" loading="lazy" width="480" height="640">`
          : '';
        const button = this.showAddToCart && product.variantId
          ? `<button type="button" class="smartcart-rcm__button button" data-variant-id="${escapeHtml(numericId(product.variantId))}"><span>${escapeHtml(text.textAdd)}</span></button>`
          : '';
        return `
          <article class="smartcart-rcm__card" role="listitem">
            <a class="smartcart-rcm__media" href="${url}">
              ${image}
              ${discount ? `<span class="smartcart-rcm__badge">-${discount}%</span>` : ''}
              ${reason ? `<span class="smartcart-rcm__reason">${escapeHtml(reason)}</span>` : ''}
            </a>
            <div class="smartcart-rcm__body">
              <a class="smartcart-rcm__title" href="${url}">${escapeHtml(product.title)}</a>
              <div class="smartcart-rcm__price">
                <span class="smartcart-rcm__now${discount ? ' smartcart-rcm__now--sale' : ''}">${escapeHtml(this.formatter.format(price))}</span>
                ${discount ? `<span class="smartcart-rcm__compare">${escapeHtml(this.formatter.format(compareAt))}</span>` : ''}
              </div>
              ${button}
            </div>
          </article>`;
      }).join('');

      // "Complete the look": the top suggestions added to the cart in one click.
      const bundle = shown.filter((entry) => entry.product.variantId).slice(0, BUNDLE_SIZE);
      if (this.footer) {
        if (this.showAddToCart && bundle.length >= 2) {
          const total = bundle.reduce((sum, entry) => sum + Number(entry.product.price), 0);
          const fill = (template) => template.replace('{count}', bundle.length).replace('{total}', this.formatter.format(total));
          const thumbs = bundle.map((entry) => (entry.product.image
            ? `<img src="${escapeHtml(imageUrl(entry.product.image, 120))}" alt="" width="48" height="64">` : '')).join('');
          const ids = bundle.map((entry) => numericId(entry.product.variantId)).join(',');
          this.footer.innerHTML = `
            <div class="smartcart-rcm__bundle">
              <div class="smartcart-rcm__bundle-thumbs">${thumbs}</div>
              <span class="smartcart-rcm__bundle-text">${escapeHtml(fill(text.textBundle))}</span>
              <button type="button" class="smartcart-rcm__button smartcart-rcm__add-all button" data-variant-ids="${ids}"><span>${escapeHtml(fill(text.textAddAll))}</span></button>
            </div>`;
        } else {
          this.footer.innerHTML = '';
        }
      }
      this.root.hidden = false;
    }

    // Why this product is suggested, shown on the image.
    reason(entry) {
      const text = this.root.dataset;
      return {
        best_seller: text.textBestSeller,
        recent_orders: text.textTrending,
        new_arrival: text.textNew,
        same_category: text.textSimilar,
      }[entry.source] || '';
    }

    async onClick(event) {
      const button = event.target.closest('.smartcart-rcm__button');
      if (!button || button.disabled) return;
      const label = button.querySelector('span');
      const original = label.textContent;
      const { textAdded, textError } = this.root.dataset;
      const ids = (button.dataset.variantIds || button.dataset.variantId).split(',').map(Number);
      button.disabled = true;

      try {
        await addToCart(button, ids);
        label.textContent = textAdded;
      } catch (error) {
        console.warn('SmartCart RCM: add to cart failed', error);
        label.textContent = textError;
      }
      setTimeout(() => {
        label.textContent = original;
        button.disabled = false;
      }, 2000);
    }
  }

  async function addToCart(source, variantIds) {
    // Ask for the theme's cart sections so the drawer can re-render without a reload.
    const sections = [...document.querySelectorAll('cart-items-component[data-section-id]')]
      .map((element) => element.dataset.sectionId);
    const events = await loadEvents();
    const deferred = events?.CartLinesUpdateEvent?.createPromise?.();

    if (deferred) {
      source.dispatchEvent(new events.CartLinesUpdateEvent({
        action: 'add',
        context: 'product',
        lines: variantIds.map((id) => ({ merchandiseId: `gid://shopify/ProductVariant/${id}`, quantity: 1 })),
        promise: deferred.promise,
      }));
    }

    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: variantIds.map((id) => ({ id, quantity: 1 })), sections: sections.join(',') }),
      });
      const result = await response.json();
      if (!response.ok || result.status) throw new Error(result.description || result.message || 'Add failed');

      const cart = await fetchCart();
      if (deferred) {
        deferred.resolve({
          cart: events.CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
          detail: { items: cart.items, source: 'smartcart-rcm', itemCount: variantIds.length, sections: result.sections, didError: false },
        });
      } else if (window.location.pathname === '/cart') {
        window.location.reload();
      }
      // No theme event to listen to: refresh the widgets ourselves.
      if (!deferred) refreshAll();
    } catch (error) {
      deferred?.reject(error);
      throw error;
    }
  }

  const widgets = [];
  let refreshTimer;
  const refreshAll = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => widgets.forEach((widget) => widget.refresh()), 300);
  };

  async function init() {
    document.querySelectorAll('.smartcart-rcm').forEach((root) => {
      if (root.dataset.ready) return;
      root.dataset.ready = 'true';
      const widget = new Widget(root);
      widgets.push(widget);
      widget.refresh();
    });

    // Any cart change in the theme (drawer quantity, remove, add) refreshes the suggestions.
    const events = await loadEvents();
    if (events?.StandardEvents?.cartLinesUpdate) {
      document.addEventListener(events.StandardEvents.cartLinesUpdate, (event) => {
        Promise.resolve(event.promise).catch(() => {}).finally(refreshAll);
      });
    }
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) refreshAll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Theme editor re-renders sections in place.
  document.addEventListener('shopify:section:load', init);
})();
