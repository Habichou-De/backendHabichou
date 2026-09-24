/* Smoke test end-to-end de l'API Habichou (lancer le serveur avant : npm run dev) */
const BASE = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;

async function api(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function check(label, cond, extra = '') {
  if (cond) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label} ${extra}`);
  }
}

async function expect(label, method, path, opts, wantStatus) {
  const r = await api(method, path, opts);
  check(`${label} → ${r.status}`, r.status === wantStatus, JSON.stringify(r.data)?.slice(0, 300));
  return r;
}

const stamp = Date.now();

async function main() {
  console.log('— Health —');
  await expect('GET /health', 'GET', '/health', {}, 200);

  console.log('— Auth —');
  const loginClient = await expect('login client', 'POST', '/auth/login', { body: { email: 'client@habichou.ma', password: 'Habichou2026!' } }, 200);
  const client = loginClient.data?.access_token;
  check('access_token client', Boolean(client));

  const loginAdmin = await expect('login admin', 'POST', '/auth/login', { body: { email: 'admin@habichou.ma', password: 'Habichou2026!' } }, 200);
  const admin = loginAdmin.data?.access_token;

  const loginLivreur = await expect('login livreur', 'POST', '/auth/login', { body: { email: 'livreur@habichou.ma', password: 'Habichou2026!' } }, 200);
  const livreur = loginLivreur.data?.access_token;
  await expect('livreur en ligne', 'PUT', '/livreur/online', { token: livreur, body: { is_online: true } }, 200);

  const refresh = await expect('refresh', 'POST', '/auth/refresh', { body: { refresh_token: loginClient.data.refresh_token } }, 200);
  const clientToken = refresh.data?.access_token ?? client;

  await expect('GET /auth/me', 'GET', '/auth/me', { token: clientToken }, 200);
  await expect('register dup email → 409', 'POST', '/auth/register', { body: { email: 'client@habichou.ma', password: 'xxxxxxxx', full_name: 'Dup' } }, 409);

  console.log('— Public —');
  const restos = await expect('GET /restaurants (geo)', 'GET', '/restaurants?lat=33.5731&lng=-7.5898', {}, 200);
  check('5 commerces seeded', Array.isArray(restos.data) && restos.data.length >= 5, `got ${restos.data?.length}`);
  check('distance_km presente', restos.data?.[0]?.distance_km !== undefined);

  const resto = await expect('GET /restaurants/:id', 'GET', '/restaurants/seed-resto-1', {}, 200);
  check('menu non vide', resto.data?.products?.length >= 4);
  const burgerMenu = await expect('GET /restaurants/Burger Time', 'GET', '/restaurants/seed-resto-2', {}, 200);
  const classic = burgerMenu.data.products.find((p) => p.name === 'Classic Burger');
  const frites = burgerMenu.data.products.find((p) => p.name === 'Frites Maison');
  check('Classic Burger a des options', Boolean(classic?.options));

  console.log('— Adresses —');
  const addresses = await expect('GET /addresses', 'GET', '/addresses', { token: clientToken }, 200);
  const addressId = addresses.data?.[0]?.id;
  check('adresse seed presente', Boolean(addressId));
  const newAddr = await expect('POST /addresses', 'POST', '/addresses', {
    token: clientToken,
    body: { label: `Adresse test ${stamp}`, latitude: 33.58, longitude: -7.61, address_text: '99 Rue Test, Casablanca' },
  }, 201);
  await expect('DELETE address', 'DELETE', `/addresses/${newAddr.data.id}`, { token: clientToken }, 204);

  console.log('— Commande restaurant (avec supplément) —');
  const order = await expect('POST /orders', 'POST', '/orders', {
    token: clientToken,
    body: {
      address_id: addressId,
      payment_method: 'cash',
      items: [
        { product_id: classic.id, quantity: 2, options: [{ group: 'Suppléments', name: 'Bacon', price: 999 }] },
        { product_id: frites.id, quantity: 1 },
      ],
    },
  }, 201);
  const orderId = order.data?.id;
  if (!orderId) {
    console.log('❌ abort : commande non creee');
    process.exit(1);
  }
  // 2 × (45 + 8 bacon) + 20 frites + 15 frais = 141
  check('total avec supplement catalog (141)', order.data?.total_price === 141, `got ${order.data?.total_price}`);
  check('unit_price item = 53', order.data?.items?.[0]?.unit_price === 53, `got ${order.data?.items?.[0]?.unit_price}`);
  await expect('GET /orders/me', 'GET', '/orders/me', { token: clientToken }, 200);
  await expect('GET /orders/:id', 'GET', `/orders/${orderId}`, { token: clientToken }, 200);
  await expect('GET /admin/orders/:id (admin)', 'GET', `/admin/orders/${orderId}`, { token: admin }, 200);

  console.log('— Pay —');
  await expect('pay sur commande cash → 400', 'POST', `/orders/${orderId}/pay`, { token: clientToken }, 400);
  const cardOrder = await expect('POST /orders (card)', 'POST', '/orders', {
    token: clientToken,
    body: { address_id: addressId, payment_method: 'card', items: [{ product_id: frites.id, quantity: 1 }] },
  }, 201);
  const pay = await expect('POST pay (simulé)', 'POST', `/orders/${cardOrder.data.id}/pay`, { token: clientToken }, 200);
  check('pay simulé (pas de Stripe)', pay.data?.simulated === true);

  console.log('— Admin : statuts + assignation —');
  const dash = await expect('GET /admin/dashboard', 'GET', '/admin/dashboard', { token: admin }, 200);
  check('orders_today > 0', dash.data?.orders_today >= 1);
  await expect('admin → client 403', 'GET', '/admin/orders', { token: clientToken }, 403);
  await expect('confirm', 'PUT', `/admin/orders/${orderId}/status`, { token: admin, body: { status: 'confirmed' } }, 200);
  await expect('preparing', 'PUT', `/admin/orders/${orderId}/status`, { token: admin, body: { status: 'preparing' } }, 200);
  const livreurs = await expect('GET /admin/livreurs', 'GET', '/admin/livreurs', { token: admin }, 200);
  check('livreur seeded', livreurs.data?.length >= 1);
  const assigned = await expect('assign auto', 'PUT', `/admin/orders/${orderId}/assign`, { token: admin, body: { auto: true } }, 200);
  check('livreur assigne', Boolean(assigned.data?.livreur?.user), (JSON.stringify(assigned.data?.livreur) ?? '').slice(0, 200));
  await expect('transition invalide (back)', 'PUT', `/admin/orders/${orderId}/status`, { token: admin, body: { status: 'confirmed' } }, 400);

  console.log('— Livreur : GPS + statuts —');
  await expect('GET /livreur/profile', 'GET', '/livreur/profile', { token: livreur }, 200);
  await expect('PUT /livreur/online', 'PUT', '/livreur/online', { token: livreur, body: { is_online: true } }, 200);
  const assignedToMe = await expect('GET assigned', 'GET', '/livreur/orders/assigned', { token: livreur }, 200);
  check('course assignee visible', assignedToMe.data?.some((o) => o.id === orderId), `got ${assignedToMe.data?.length}`);
  await expect('location', 'PUT', '/livreur/location', { token: livreur, body: { lat: 33.59, lng: -7.60, order_id: orderId } }, 200);
  await expect('picked_up', 'PUT', `/livreur/orders/${orderId}/status`, { token: livreur, body: { status: 'picked_up' } }, 200);
  await expect('on_the_way', 'PUT', `/livreur/orders/${orderId}/status`, { token: livreur, body: { status: 'on_the_way' } }, 200);
  await expect('delivered', 'PUT', `/livreur/orders/${orderId}/status`, { token: livreur, body: { status: 'delivered' } }, 200);
  await expect('stats', 'GET', '/livreur/stats', { token: livreur }, 200);

  const delivered = await expect('commande livrée', 'GET', `/orders/${orderId}`, { token: clientToken }, 200);
  check('status=delivered', delivered.data?.status === 'delivered');
  check('payment_status=paid (cash)', delivered.data?.payment_status === 'paid');
  await expect('noter', 'POST', `/orders/${orderId}/rate`, { token: clientToken, body: { rating: 5, comment: 'Parfait' } }, 201);
  await expect('deja notée → 409', 'POST', `/orders/${orderId}/rate`, { token: clientToken, body: { rating: 4 } }, 409);

  console.log('— Demande libre (devis) —');
  const cr = await expect('POST /custom-requests', 'POST', '/custom-requests', {
    token: clientToken,
    body: { description_text: `Flowers and chocolates ${stamp}`, estimated_budget: 150, address_id: addressId },
  }, 201);
  await expect('GET /custom-requests/me', 'GET', '/custom-requests/me', { token: clientToken }, 200);
  await expect('admin liste', 'GET', '/admin/custom-requests?status=pending', { token: admin }, 200);
  await expect('quote', 'PUT', `/admin/custom-requests/${cr.data.id}/quote`, { token: admin, body: { admin_quote_price: 180 } }, 200);
  const quoted = await expect('client recoit devis', 'GET', `/custom-requests/${cr.data.id}`, { token: clientToken }, 200);
  check('status=quoted', quoted.data?.status === 'quoted');
  await expect('accept devis', 'POST', `/custom-requests/${cr.data.id}/accept`, { token: clientToken }, 200);
  const crOrder = await expect('commande depuis devis', 'POST', '/orders', {
    token: clientToken,
    body: { address_id: addressId, payment_method: 'cash', custom_request_id: cr.data.id },
  }, 201);
  check('total = 180 + 15', crOrder.data?.total_price === 195, `got ${crOrder.data?.total_price}`);
  await expect('doublon devis → 409', 'POST', '/orders', {
    token: clientToken,
    body: { address_id: addressId, payment_method: 'cash', custom_request_id: cr.data.id },
  }, 409);

  console.log('— Admin : CRUD commerce + produits —');
  const resto2 = await expect('POST /admin/restaurants', 'POST', '/admin/restaurants', {
    token: admin,
    body: {
      name: `Smoke Snack ${stamp}`,
      category: 'snack',
      address: '1 Rue Smoke',
      latitude: 33.57,
      longitude: -7.59,
      is_open: true,
      opening_hours: { open: '09:00', close: '22:30' },
      logo_url: 'https://example.com/smoke-logo.png',
    },
  }, 201);
  check('opening_hours creee', resto2.data?.opening_hours?.open === '09:00' && resto2.data?.opening_hours?.close === '22:30', JSON.stringify(resto2.data?.opening_hours));
  check('logo_url cree', resto2.data?.logo_url === 'https://example.com/smoke-logo.png', String(resto2.data?.logo_url));

  await expect('PUT opening_hours invalide (25:99) → 400', 'PUT', `/admin/restaurants/${resto2.data.id}`, {
    token: admin,
    body: { opening_hours: { open: '25:99', close: '22:00' } },
  }, 400);
  await expect('PUT opening_hours format invalide → 400', 'PUT', `/admin/restaurants/${resto2.data.id}`, {
    token: admin,
    body: { opening_hours: { open: '9h', close: '22:00' } },
  }, 400);

  const updResto = await expect('PUT horaires valides + efface logo', 'PUT', `/admin/restaurants/${resto2.data.id}`, {
    token: admin,
    body: { opening_hours: { open: '08:30', close: '23:45' }, logo_url: null },
  }, 200);
  check('horaires mis a jour', updResto.data?.opening_hours?.open === '08:30' && updResto.data?.opening_hours?.close === '23:45', JSON.stringify(updResto.data?.opening_hours));
  check('logo_url efface (null)', updResto.data?.logo_url === null, String(updResto.data?.logo_url));

  const prod = await expect('POST product', 'POST', `/admin/restaurants/${resto2.data.id}/products`, {
    token: admin,
    body: { name: 'Panini Smoke', price: 30, category: 'Paninis' },
  }, 201);
  await expect('PUT product options', 'PUT', `/admin/products/${prod.data.id}`, {
    token: admin,
    body: { options: { Suppléments: [{ name: 'Fromage', price: 5 }] } },
  }, 200);
  const prodOpts = await expect('GET product options', 'GET', `/products/${prod.data.id}`, {}, 200);
  check('options persistees', prodOpts.data?.options?.Suppléments?.[0]?.name === 'Fromage' && prodOpts.data?.options?.Suppléments?.[0]?.price === 5, JSON.stringify(prodOpts.data?.options));
  await expect('PUT product options a null', 'PUT', `/admin/products/${prod.data.id}`, { token: admin, body: { options: null } }, 200);
  const prodNoOpts = await expect('GET product options null', 'GET', `/products/${prod.data.id}`, {}, 200);
  check('options effacees (null)', prodNoOpts.data?.options === null, JSON.stringify(prodNoOpts.data?.options));

  await expect('PUT product dispo', 'PUT', `/admin/products/${prod.data.id}`, { token: admin, body: { is_available: false } }, 200);
  await expect('produit indisponible → 400', 'POST', '/orders', {
    token: clientToken,
    body: { address_id: addressId, payment_method: 'cash', items: [{ product_id: prod.data.id, quantity: 1 }] },
  }, 400);
  await expect('DELETE product jamais commande', 'DELETE', `/admin/products/${prod.data.id}`, { token: admin }, 204);
  await expect('DELETE restaurant sans commandes', 'DELETE', `/admin/restaurants/${resto2.data.id}`, { token: admin }, 204);

  const delOrdered = await expect('DELETE restaurant avec commandes → 409', 'DELETE', '/admin/restaurants/seed-resto-2', { token: admin }, 409);
  check('code HAS_ORDERS', delOrdered.data?.error?.code === 'HAS_ORDERS', JSON.stringify(delOrdered.data));
  const closedResto = await expect('fermeture auto apres 409', 'GET', '/admin/restaurants/seed-resto-2', { token: admin }, 200);
  check('is_open=false apres 409', closedResto.data?.is_open === false, `got ${closedResto.data?.is_open}`);
  await expect('reactiver seed-resto-2', 'PUT', '/admin/restaurants/seed-resto-2', { token: admin, body: { is_open: true } }, 200);
  await expect('DELETE restaurant inexistant → 404', 'DELETE', `/admin/restaurants/${stamp}-nope`, { token: admin }, 404);
  await expect('PUT /admin/livreurs/:id (hors ligne)', 'PUT', `/admin/livreurs/${loginLivreur.data.user.id}`, {
    token: admin,
    body: { is_online: false },
  }, 200);

  console.log('— Notifications —');
  const notifs = await expect('GET /notifications/me', 'GET', '/notifications/me', { token: clientToken }, 200);
  check('notifications recues', notifs.data?.length >= 3, `got ${notifs.data?.length}`);
  if (notifs.data?.[0]) {
    await expect('mark read', 'PUT', `/notifications/${notifs.data[0].id}/read`, { token: clientToken }, 200);
  }

  console.log('— Upload Supabase Storage —');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'smoke.png');
  const up = await api('POST', '/uploads?folder=custom_requests', { token: clientToken, form });
  check(`upload → ${up.status}`, up.status === 201 && typeof up.data?.url === 'string', JSON.stringify(up.data)?.slice(0, 300));
  if (up.data?.url) {
    const img = await fetch(up.data.url);
    check('URL publique accessible', img.status === 200, `status ${img.status}`);
  }

  console.log(failures === 0 ? '\n✅ SMOKE TEST : tous les checks passent' : `\n❌ SMOKE TEST : ${failures} echec(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('ERREUR FATALE', e);
  process.exit(1);
});
