/**
 * Tier Manager Service for Cherri Hosting
 * 
 * Manages Free/Paid tier logic:
 * - Free: IPFS hosting only, no backend/database
 * - Paid (Builder/Pro/Business): Auto-generate Node.js/Python/Go backend with embedded DB
 */

export type TierLevel = 'FREE' | 'TIER1' | 'TIER2' | 'TIER3';
export type BackendRuntime = 'nodejs' | 'python' | 'go';

export interface TierConfig {
  level: TierLevel;
  name: string;
  projects: number;
  storage: number; // MB
  backendSupport: boolean;
  dbSupport: boolean;
  domains: number;
  features: string[];
  monthlyPrice: number; // USD
  piPrice: number; // Pi amount (updated dynamically)
}

export const TIER_CONFIGS: Record<TierLevel, TierConfig> = {
  FREE: {
    level: 'FREE',
    name: 'Starter',
    projects: 1,
    storage: 500,
    backendSupport: false,
    dbSupport: false,
    domains: 0,
    features: ['1 project', 'IPFS hosting', '500 MB storage', 'Community support'],
    monthlyPrice: 0,
    piPrice: 0,
  },
  TIER1: {
    level: 'TIER1',
    name: 'Builder',
    projects: 3,
    storage: 2000,
    backendSupport: true,
    dbSupport: true,
    domains: 1,
    features: [
      '3 projects',
      'Node.js/Python/Go backend',
      'SQLite or PostgreSQL',
      '2 GB storage',
      '1 Pi domain',
      'Priority support',
    ],
    monthlyPrice: 35,
    piPrice: 150, // Will be updated from live pricing
  },
  TIER2: {
    level: 'TIER2',
    name: 'Pro',
    projects: 999,
    storage: 10000,
    backendSupport: true,
    dbSupport: true,
    domains: 5,
    features: [
      'Unlimited projects',
      'Advanced backends',
      'PostgreSQL support',
      '10 GB storage',
      '5 Pi domains',
      'Analytics dashboard',
    ],
    monthlyPrice: 143,
    piPrice: 600,
  },
  TIER3: {
    level: 'TIER3',
    name: 'Business',
    projects: 999,
    storage: 50000,
    backendSupport: true,
    dbSupport: true,
    domains: 999,
    features: [
      'Unlimited projects',
      'Team collaboration',
      'API access',
      '50 GB storage',
      'Unlimited domains',
      'Featured marketplace',
    ],
    monthlyPrice: 350,
    piPrice: 1500,
  },
};

export interface BackendGenerationRequest {
  projectId: string;
  projectName: string;
  runtime: BackendRuntime;
  database: 'sqlite' | 'postgresql';
  framework?: string; // express, fastapi, gin, etc.
}

export interface BackendTemplate {
  runtime: BackendRuntime;
  framework: string;
  entryPoint: string;
  dockerFile: string;
  packageJson?: Record<string, string>;
  requirementsTxt?: string;
}

export class TierManager {
  /**
   * Get tier configuration by level.
   */
  getTierConfig(level: TierLevel): TierConfig {
    return TIER_CONFIGS[level];
  }

  /**
   * Check if tier supports backend deployments.
   */
  supportsBackend(tier: TierLevel): boolean {
    return this.getTierConfig(tier).backendSupport;
  }

  /**
   * Check if tier supports database.
   */
  supportsDatabase(tier: TierLevel): boolean {
    return this.getTierConfig(tier).dbSupport;
  }

  /**
   * Get max projects allowed for tier.
   */
  getMaxProjects(tier: TierLevel): number {
    return this.getTierConfig(tier).projects;
  }

  /**
   * Get storage limit in MB.
   */
  getStorageLimit(tier: TierLevel): number {
    return this.getTierConfig(tier).storage;
  }

  /**
   * Get max custom domains for tier.
   */
  getMaxDomains(tier: TierLevel): number {
    return this.getTierConfig(tier).domains;
  }

  /**
   * Generate backend starter template for paid tier.
   * Used to auto-create backend when deploying to paid tier.
   */
  generateBackendTemplate(req: BackendGenerationRequest): BackendTemplate {
    const { runtime, database, framework } = req;

    if (runtime === 'nodejs') {
      return this.generateNodeJsTemplate(database, framework);
    } else if (runtime === 'python') {
      return this.generatePythonTemplate(database, framework);
    } else if (runtime === 'go') {
      return this.generateGoTemplate(database, framework);
    }

    throw new Error(`Unsupported runtime: ${runtime}`);
  }

  /**
   * Generate verification.txt content for Pi Developer Portal.
   */
  generateVerificationContent(
    domainName: string,
    verificationToken: string,
    projectName: string
  ): string {
    return `domain=${domainName}
project=${projectName}
verification=${verificationToken}
timestamp=${new Date().toISOString()}
platform=cherri-hosting
api_version=1.0.0
`;
  }

  private generateNodeJsTemplate(
    database: 'sqlite' | 'postgresql',
    framework?: string
  ): BackendTemplate {
    const fw = framework || 'express';

    return {
      runtime: 'nodejs',
      framework: fw,
      entryPoint: 'src/index.ts',
      dockerFile: this.getNodeJsDockerfile(database),
    };
  }

  private generatePythonTemplate(
    database: 'sqlite' | 'postgresql',
    framework?: string
  ): BackendTemplate {
    const fw = framework || 'flask';

    return {
      runtime: 'python',
      framework: fw,
      entryPoint: 'app.py',
      dockerFile: this.getPythonDockerfile(database),
    };
  }

  private generateGoTemplate(
    database: 'sqlite' | 'postgresql',
    framework?: string
  ): BackendTemplate {
    const fw = framework || 'gin';

    return {
      runtime: 'go',
      framework: fw,
      entryPoint: 'main.go',
      dockerFile: this.getGoDockerfile(database),
    };
  }

  private getNodeJsDockerfile(database: 'sqlite' | 'postgresql'): string {
    return `FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
`;
  }

  private getPythonDockerfile(database: 'sqlite' | 'postgresql'): string {
    return `FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

CMD ["python", "app.py"]
`;
  }

  private getGoDockerfile(database: 'sqlite' | 'postgresql'): string {
    return `FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o app .

FROM alpine:latest
RUN apk --no-cache add ca-certificates

WORKDIR /root/
COPY --from=builder /app/app .

EXPOSE 8080

CMD ["./app"]
`;
  }
}

export const tierManager = new TierManager();
