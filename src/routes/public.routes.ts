import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createAddressSchema, idParam, restaurantsQuery, updateAddressSchema } from '../schemas';
import { haversineKm, roundKm } from '../lib/geo';
import { env } from '../config/env';

export const publicRouter = Router();

publicRouter.get(
  '/restaurants',
  validate({ query: restaurantsQuery }),
  asyncHandler(async (req, res) => {
    const { lat, lng, category, q } = req.validated?.query as {
      lat?: number;
      lng?: number;
      category?: string;
      q?: string;
    };

    const restaurants = await prisma.restaurant.findMany({
      where: {
        ...(category ? { category: category as never } : {}),
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { created_at: 'desc' },
    });

    let result = restaurants.map((r) => ({
      ...r,
      distance_km:
        lat != null && lng != null ? roundKm(haversineKm(lat, lng, r.latitude, r.longitude)) : null,
    }));

    if (lat != null && lng != null) {
      result = result
        .filter((r) => r.distance_km == null || r.distance_km <= env.NEARBY_RADIUS_KM)
        .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
    }

    res.json(result);
  }),
);

publicRouter.get(
  '/restaurants/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const restaurant = await prisma.restaurant.findUnique({
      where: { id },
      include: {
        products: {
          where: {},
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        },
      },
    });
    if (!restaurant) throw ApiError.notFound('Commerce introuvable');
    res.json(restaurant);
  }),
);

publicRouter.get(
  '/products/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { restaurant: { select: { id: true, name: true, is_open: true } } },
    });
    if (!product) throw ApiError.notFound('Produit introuvable');
    res.json(product);
  }),
);

export const addressRouter = Router();
addressRouter.use(requireAuth);

addressRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const addresses = await prisma.address.findMany({
      where: { user_id: req.user!.id },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
    res.json(addresses);
  }),
);

addressRouter.post(
  '/',
  validate(createAddressSchema),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const body = req.validated?.body as {
      label: string;
      latitude: number;
      longitude: number;
      address_text: string;
      is_default?: boolean;
    };
    const count = await prisma.address.count({ where: { user_id: userId } });
    const makeDefault = body.is_default || count === 0;

    const address = await prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({ where: { user_id: userId }, data: { is_default: false } });
      }
      return tx.address.create({
        data: { ...body, is_default: makeDefault, user_id: userId },
      });
    });
    res.status(201).json(address);
  }),
);

addressRouter.put(
  '/:id',
  validate(updateAddressSchema),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const existing = await prisma.address.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== userId) throw ApiError.notFound('Adresse introuvable');

    const body = req.validated?.body as Record<string, unknown> | undefined;
    const address = await prisma.$transaction(async (tx) => {
      if (body?.is_default) {
        await tx.address.updateMany({ where: { user_id: userId }, data: { is_default: false } });
      }
      return tx.address.update({ where: { id: existing.id }, data: body ?? {} });
    });
    res.json(address);
  }),
);

addressRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const existing = await prisma.address.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== userId) throw ApiError.notFound('Adresse introuvable');

    const [orderCount, crCount] = await Promise.all([
      prisma.order.count({ where: { address_id: existing.id } }),
      prisma.customRequest.count({ where: { address_id: existing.id } }),
    ]);
    if (orderCount > 0 || crCount > 0) {
      throw ApiError.conflict('Adresse utilisee par des commandes / demandes', 'ADDRESS_IN_USE');
    }

    await prisma.address.delete({ where: { id: existing.id } });
    res.status(204).send();
  }),
);
