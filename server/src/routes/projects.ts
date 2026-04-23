import { Router, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';

export const projectsRouter = Router();

// All project routes require authentication
projectsRouter.use(piAuthMiddleware);

const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  customDomain: z.string().max(255).optional(),
});

/**
 * GET /api/projects
 * List all projects for the authenticated user.
 */
projectsRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const projects = await prisma.project.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, cid: true, gateway: true, status: true, createdAt: true, size: true },
        },
        _count: { select: { deployments: true } },
      },
    });
    res.json({ projects });
  } catch (err) {
    logger.error('Failed to list projects', { error: err });
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

/**
 * POST /api/projects
 * Create a new project.
 */
projectsRouter.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    return;
  }

  try {
    const project = await prisma.project.create({
      data: {
        ...parsed.data,
        userId: req.user!.id,
      },
    });
    res.status(201).json({ project });
  } catch (err) {
    logger.error('Failed to create project', { error: err });
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * GET /api/projects/:id
 * Get a single project with all deployments.
 */
projectsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, cid: true, gateway: true, status: true, size: true, createdAt: true },
        },
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project });
  } catch (err) {
    logger.error('Failed to get project', { error: err });
    res.status(500).json({ error: 'Failed to get project' });
  }
});

/**
 * PATCH /api/projects/:id
 * Update a project.
 */
projectsRouter.patch('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const parsed = createProjectSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    return;
  }

  try {
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ project });
  } catch (err) {
    logger.error('Failed to update project', { error: err });
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * DELETE /api/projects/:id
 * Delete a project and all its deployments.
 */
projectsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await prisma.deployment.deleteMany({ where: { projectId: req.params.id } });
    await prisma.project.delete({ where: { id: req.params.id } });

    res.status(204).send();
  } catch (err) {
    logger.error('Failed to delete project', { error: err });
    res.status(500).json({ error: 'Failed to delete project' });
  }
});
