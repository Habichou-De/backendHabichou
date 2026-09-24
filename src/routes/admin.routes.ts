import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../lib/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  assignSchema,
  createProductSchema,
  createRestaurantSchema,
  idParam,
  adminOrderStatusSchema,
  statusFilterQuery,
  updateLivreurSchema,
  updateProductSchema,
  updateRestaurantSchema,
} from '../schemas';
import { assignLivreur, changeOrderStatus } from '../services/order.service';
import { haversineKm, roundKm } from '../lib/geo';
import { orderInclude } from './order.routes';
import type { Prisma } from '@prisma/client';

const productInclude = { restaurant: { select: { id: true, name: true } } } as const;
const livreurInclude = {
  user: { select: { id: true, full_name: true, phone: true, email: true, avatar_url: true } },
  orders: {
    where: { status: { in: ['confirmed', 'preparing', 'picked_up', 'on_the_way'] as never } },
    select: { id: true },
  },
} as const;

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

/* ---------------- Dashboard ---------------- */

adminRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [ordersToday, revenue, pendingCustomRequests, activeOrders, livreursOnline, totalRestaurants] =
      await Promise.all([
        prisma.order.count({ where: { created_at: { gte: startOfDay } } }),
        prisma.order.aggregate({
          where: { created_at: { gte: startOfDay }, status: { not: 'cancelled' } },
          _sum: { total_price: true },
        }),
        prisma.customRequest.count({ where: { status: 'pending' } }),
        prisma.order.count({ where: { status: { in: ['pending', 'confirmed', 'preparing', 'picked_up', 'on_the_way'] } } }),
        prisma.livreur.count({ where: { is_online: true } }),
        prisma.restaurant.count(),
      ]);

    res.json({
      orders_today: ordersToday,
      revenue_today: revenue._sum.total_price ?? 0,
      pending_custom_requests: pendingCustomRequests,
      active_orders: activeOrders,
      livreurs_online: livreursOnline,
      total_restaurants: totalRestaurants,
    });
  }),
);

/* ---------------- Restaurants ---------------- */

adminRouter.get(
  '/restaurants',
  asyncHandler(async (_req, res) => {
    const restaurants = await prisma.restaurant.findMany({
      include: { _count: { select: { products: true, orders: true } } },
      orderBy: { created_at: 'desc' },
    });
    res.json(restaurants);
  }),
);

adminRouter.get(
  '/restaurants/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.params.id },
      include: { products: { orderBy: [{ category: 'asc' }, { name: 'asc' }] } },
    });
    if (!restaurant) throw ApiError.notFound('Commerce introuvable');
    res.json(restaurant);
  }),
);

adminRouter.post(
  '/restaurants',
  validate(createRestaurantSchema),
  asyncHandler(async (req, res) => {
    const body = req.validated?.body as Record<string, unknown>;
    const restaurant = await prisma.restaurant.create({
      data: { ...(body as Prisma.RestaurantUncheckedCreateInput), created_by_admin_id: req.user!.id },
    });
    res.status(201).json(restaurant);
  }),
);

adminRouter.put(
  '/restaurants/:id',
  validate(updateRestaurantSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.restaurant.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Commerce introuvable');
    const body = req.validated?.body as Record<string, unknown>;
    const restaurant = await prisma.restaurant.update({ where: { id: existing.id }, data: body as never });
    res.json(restaurant);
  }),
);

adminRouter.delete(
  '/restaurants/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.restaurant.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Commerce introuvable');
    const orderCount = await prisma.order.count({ where: { restaurant_id: existing.id } });
    if (orderCount > 0) {
      await prisma.restaurant.update({ where: { id: existing.id }, data: { is_open: false } });
      throw ApiError.conflict('Commerce deja commande : fermeture a la place de la suppression', 'HAS_ORDERS');
    }
    await prisma.restaurant.delete({ where: { id: existing.id } });
    res.status(204).send();
  }),
);

/* ---------------- Produits ---------------- */

adminRouter.get(
  '/restaurants/:id/products',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.id } });
    if (!restaurant) throw ApiError.notFound('Commerce introuvable');
    const products = await prisma.product.findMany({
      where: { restaurant_id: restaurant.id },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    res.json(products);
  }),
);

adminRouter.post(
  '/restaurants/:id/products',
  validate(createProductSchema),
  asyncHandler(async (req, res) => {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.id } });
    if (!restaurant) throw ApiError.notFound('Commerce introuvable');
    const body = req.validated?.body as Record<string, unknown>;
    const product = await prisma.product.create({
      data: { ...(body as Prisma.ProductUncheckedCreateInput), restaurant_id: restaurant.id },
      include: productInclude,
    });
    res.status(201).json(product);
  }),
);

adminRouter.put(
  '/products/:id',
  validate(updateProductSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Produit introuvable');
    const body = req.validated?.body as Record<string, unknown>;
    const product = await prisma.product.update({ where: { id: existing.id }, data: body as never, include: productInclude });
    res.json(product);
  }),
);

adminRouter.delete(
  '/products/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Produit introuvable');
    const used = await prisma.orderItem.count({ where: { product_id: existing.id } });
    if (used > 0) {
      const product = await prisma.product.update({
        where: { id: existing.id },
        data: { is_available: false },
        include: productInclude,
      });
      return res.json(product);
    }
    await prisma.product.delete({ where: { id: existing.id } });
    res.status(204).send();
  }),
);

/* ---------------- Commandes ---------------- */

adminRouter.get(
  '/orders',
  validate({ query: statusFilterQuery }),
  asyncHandler(async (req, res) => {
    const { status } = req.validated?.query as { status?: string };
    const orders = await prisma.order.findMany({
      where: status ? { status: status as never } : {},
      include: orderInclude,
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    res.json(orders);
  }),
);

adminRouter.get(
  '/orders/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: orderInclude });
    if (!order) throw ApiError.notFound('Commande introuvable');
    res.json(order);
  }),
);

adminRouter.put(
  '/orders/:id/status',
  validate(adminOrderStatusSchema),
  asyncHandler(async (req, res) => {
    const { status } = req.validated?.body as { status: 'confirmed' | 'preparing' | 'cancelled' };
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) throw ApiError.notFound('Commande introuvable');
    const updated = await changeOrderStatus(order, status, { actorRole: 'admin' });
    res.json(updated);
  }),
);

adminRouter.put(
  '/orders/:id/assign',
  validate(assignSchema),
  asyncHandler(async (req, res) => {
    const body = req.validated?.body as { livreur_id?: string; auto?: boolean };
    const updated = await assignLivreur(req.params.id, body.livreur_id ?? null, body.auto ?? !body.livreur_id);
    res.json(updated);
  }),
);

/* ---------------- Livreurs ---------------- */

adminRouter.get(
  '/livreurs',
  asyncHandler(async (_req, res) => {
    const livreurs = await prisma.livreur.findMany({ include: livreurInclude, orderBy: { created_at: 'desc' } });
    const activeCounts = await prisma.order.groupBy({
      by: ['livreur_id'],
      where: { livreur_id: { not: null }, status: { in: ['confirmed', 'preparing', 'picked_up', 'on_the_way'] } },
      _count: { _all: true },
    });
    res.json(
      livreurs.map((l) => ({
        ...l,
        active_orders: activeCounts.find((c) => c.livreur_id === l.id)?._count._all ?? 0,
      })),
    );
  }),
);

adminRouter.put(
  '/livreurs/:id',
  validate(updateLivreurSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.livreur.findUnique({ where: { user_id: req.params.id } });
    if (!existing) throw ApiError.notFound('Livreur introuvable');
    const body = req.validated?.body as Record<string, unknown>;
    const livreur = await prisma.livreur.update({ where: { id: existing.id }, data: body, include: livreurInclude });
    res.json(livreur);
  }),
);

adminRouter.get(
  '/livreurs/map',
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const livreurs = await prisma.livreur.findMany({
      where: { current_lat: { not: null }, current_lng: { not: null } },
      include: { user: { select: { id: true, full_name: true, phone: true } } },
    });
    res.json(
      livreurs.map((l) => ({
        ...l,
        distance_km:
          Number.isFinite(lat) && Number.isFinite(lng)
            ? roundKm(haversineKm(lat, lng, l.current_lat!, l.current_lng!))
            : null,
      })),
    );
  }),
);
