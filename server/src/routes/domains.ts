/**
 * Domain Management Routes
 * 
 * Handles:
 * - Domain availability checking
 * - Domain registration
 * - Subdomain assignment
 * - Verification file generation
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { dnsProvider } from '../services/dns/provider';
import { verificationService } from '../services/verification/verificationService';

const router = Router();

// Check domain availability
router.post('/check', async (req: Request, res: Response) => {
  try {
    const body = z.object({
      domain: z.string().min(3).max(63),
      tier: z.string().optional(),
    }).parse(req.body);

    const result = await dnsProvider.checkAvailability(body.domain);

    res.json({
      available: result.available,
      domain: result.domain,
      alternatives: result.alternatives,
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Register/claim a domain (requires auth for paid tier)
router.post('/register', piAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      domain: z.string().min(3).max(63),
      tld: z.enum(['.pie', '.pi']).optional(),
    }).parse(req.body);

    const userId = req.user?.piUserId || 'unknown';
    const domainInfo = await dnsProvider.registerDomain(
      body.domain,
      userId,
      body.tld || '.pie'
    );

    res.json({
      success: true,
      domain: domainInfo.name,
      owner: domainInfo.owner,
      verificationToken: domainInfo.verificationToken,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to register domain' });
  }
});

// Assign free tier subdomain
router.post('/subdomain/assign', piAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      projectName: z.string().min(1).max(63),
    }).parse(req.body);

    const userId = req.user?.piUserId || 'unknown';
    const subdomain = await dnsProvider.assignSubdomain(
      body.projectName,
      userId
    );

    res.json({
      subdomain,
      fullUrl: `https://${subdomain}`,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to assign subdomain' });
  }
});

// Get verification.txt for a domain
router.get('/verify/:domain', async (req: Request, res: Response) => {
  try {
    const paramDomain = req.params.domain;
    const domain = Array.isArray(paramDomain) ? paramDomain[0] : paramDomain;

    const token = await dnsProvider.getVerificationToken(domain);

    const verification = verificationService.generateVerificationResponse({
      domainName: domain,
      projectName: 'my-project',
      userId: domain.split('.')[1] || 'unknown',
      verificationToken: token,
    });

    res.json(verification);
  } catch (error: any) {
    res.status(404).json({ error: error.message || 'Domain not found' });
  }
});

// Point domain to deployment (set CNAME record)
router.post('/:domain/point-to', piAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const paramDomain = req.params.domain;
    const domain = Array.isArray(paramDomain) ? paramDomain[0] : paramDomain;
    const body = z.object({
      deploymentCID: z.string(),
    }).parse(req.body);

    const domainInfo = await dnsProvider.pointToDeployment(
      domain,
      body.deploymentCID
    );

    res.json({
      success: true,
      domain: domainInfo.name,
      deploymentCID: body.deploymentCID,
      dnsRecords: domainInfo.dnsRecords,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to point domain' });
  }
});

export default router;
