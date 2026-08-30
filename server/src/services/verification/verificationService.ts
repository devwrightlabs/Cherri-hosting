/**
 * Verification Service for Pi Developer Portal
 * 
 * Generates and serves verification.txt files for domain verification.
 * Allows users to prove ownership of a domain via verification file.
 */

import { tierManager } from '../tier/tierManager';

export interface VerificationRequest {
  domainName: string;
  projectName: string;
  userId: string;
  verificationToken: string;
}

export interface VerificationResponse {
  domainName: string;
  projectName: string;
  verified: boolean;
  verificationContent: string;
  fileUrl: string;
  instructions: string;
}

export class VerificationService {
  /**
   * Generate verification.txt content for a domain.
   * Content is formatted for Pi Developer Portal requirements.
   */
  generateVerificationContent(req: VerificationRequest): string {
    const { domainName, projectName, userId, verificationToken } = req;

    return tierManager.generateVerificationContent(
      domainName,
      verificationToken,
      projectName
    );
  }

  /**
   * Build the full verification.txt file path.
   * Format: /.well-known/verification.txt
   */
  getVerificationFilePath(): string {
    return '/.well-known/verification.txt';
  }

  /**
   * Generate verification response with instructions.
   */
  generateVerificationResponse(req: VerificationRequest): VerificationResponse {
    const content = this.generateVerificationContent(req);
    const filePath = this.getVerificationFilePath();

    return {
      domainName: req.domainName,
      projectName: req.projectName,
      verified: false, // Verified only after successful check
      verificationContent: content,
      fileUrl: `https://${req.domainName}${filePath}`,
      instructions: this.generateInstructions(req.domainName, filePath, content),
    };
  }

  /**
   * Generate human-readable verification instructions.
   */
  private generateInstructions(domainName: string, filePath: string, content: string): string {
    return `
=== Domain Verification Instructions ===

1. Create a file at the following path in your project:
   ${filePath}

2. Add this content to verification.txt:
   ${content.split('\n').join('\n   ')}

3. Deploy your project to ${domainName}

4. Verify the file is accessible at:
   ${`https://${domainName}${filePath}`}

5. Once verified, your domain will be linked to your Pi Developer Portal account.

Note: The verification file must remain accessible for as long as you want to keep the domain linked.
`;
  }

  /**
   * Parse verification.txt and check if it's valid.
   */
  parseVerification(content: string): {
    domain?: string;
    project?: string;
    verification?: string;
    valid: boolean;
  } {
    const lines = content.split('\n');
    const data: Record<string, string> = {};

    lines.forEach((line) => {
      const [key, ...rest] = line.split('=');
      if (key && rest.length > 0) {
        data[key.trim()] = rest.join('=').trim();
      }
    });

    const valid = !!(
      data.domain &&
      data.project &&
      data.verification &&
      data.verification.startsWith('cherri_')
    );

    return {
      domain: data.domain,
      project: data.project,
      verification: data.verification,
      valid,
    };
  }

  /**
   * Build a verification check request object.
   * Used when submitting verification to Pi Developer Portal.
   */
  buildVerificationCheckRequest(
    domainName: string,
    verificationToken: string,
    projectId: string
  ) {
    return {
      domain: domainName,
      verification_token: verificationToken,
      project_id: projectId,
      platform: 'cherri-hosting',
      timestamp: new Date().toISOString(),
    };
  }
}

export const verificationService = new VerificationService();
