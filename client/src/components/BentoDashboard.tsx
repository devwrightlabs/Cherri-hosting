/**
 * Redesigned Bento Dashboard
 * 
 * Features:
 * - Bento grid layout (responsive, visually interesting)
 * - Cyan/Teal primary color scheme
 * - Shimmer buttons with smooth animations
 * - Magic UI elements (glassmorphism, gradients)
 * - Free/Paid tier differentiation
 */

import { motion } from 'framer-motion';
import Card from './ui/Card';
import Button from './ui/Button';
import Badge from './ui/Badge';

interface BentoDashboardProps {
  tier: string;
  projectsCount: number;
  projectsLimit: number;
  storageUsed: number;
  storageLimit: number;
  domainsCount: number;
  domainsLimit: number;
  deploymentsCount: number;
  isLoading?: boolean;
  onCreateProject?: () => void;
  onUpgrade?: () => void;
}

export default function BentoDashboard({
  tier,
  projectsCount,
  projectsLimit,
  storageUsed,
  storageLimit,
  domainsCount,
  domainsLimit,
  deploymentsCount,
  isLoading = false,
  onCreateProject,
  onUpgrade,
}: BentoDashboardProps) {
  const isPaid = tier !== 'FREE';
  const storagePercent = (storageUsed / storageLimit) * 100;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.05, delayChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      {/* Hero stat grid - top row: 4 equal cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* Projects */}
        <motion.div variants={itemVariants}>
          <Card className="relative overflow-hidden h-24 flex flex-col justify-between p-3">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
            <div className="relative z-10">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-mut">
                Projects
              </p>
              <p className="text-2xl font-bold text-ink font-display mt-1">
                {projectsCount}
              </p>
            </div>
            <div className="relative z-10 text-xs text-ink-mut">
              {projectsLimit === 999 ? 'Unlimited' : `of ${projectsLimit}`}
            </div>
          </Card>
        </motion.div>

        {/* Deployments */}
        <motion.div variants={itemVariants}>
          <Card className="relative overflow-hidden h-24 flex flex-col justify-between p-3">
            <div className="absolute inset-0 bg-gradient-to-br from-live/10 to-transparent pointer-events-none" />
            <div className="relative z-10">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-mut">
                Deployments
              </p>
              <p className="text-2xl font-bold text-ink font-display mt-1">
                {deploymentsCount}
              </p>
            </div>
            <div className="relative z-10 text-xs text-live">All live</div>
          </Card>
        </motion.div>

        {/* Domains */}
        <motion.div variants={itemVariants}>
          <Card className="relative overflow-hidden h-24 flex flex-col justify-between p-3">
            <div className="absolute inset-0 bg-gradient-to-br from-secondary/10 to-transparent pointer-events-none" />
            <div className="relative z-10">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-mut">
                Domains
              </p>
              <p className="text-2xl font-bold text-ink font-display mt-1">
                {domainsCount}
              </p>
            </div>
            <div className="relative z-10 text-xs text-ink-mut">
              {domainsLimit === 999 ? 'Unlimited' : `of ${domainsLimit}`}
            </div>
          </Card>
        </motion.div>

        {/* Tier badge */}
        <motion.div variants={itemVariants}>
          <Card className="relative overflow-hidden h-24 flex flex-col justify-between p-3 bg-gradient-to-br from-primary/5 to-secondary/5 border-primary/30">
            <div className="relative z-10">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-mut">
                Plan
              </p>
              <Badge
                variant={isPaid ? 'success' : 'default'}
                className="mt-2 text-xs"
              >
                {tier}
              </Badge>
            </div>
            {!isPaid && (
              <Button
                size="sm"
                variant="primary"
                className="mt-auto w-full"
                onClick={onUpgrade}
              >
                Upgrade
              </Button>
            )}
          </Card>
        </motion.div>
      </div>

      {/* Storage indicator - full width */}
      <motion.div variants={itemVariants}>
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">Storage Used</p>
              <p className="text-xs text-ink-mut mt-0.5">
                {(storageUsed / 1024).toFixed(1)} GB of {(storageLimit / 1024).toFixed(1)} GB
              </p>
            </div>
            <span className="text-sm font-bold text-ink">{Math.round(storagePercent)}%</span>
          </div>

          {/* Progress bar with gradient */}
          <div className="h-2.5 bg-surface-800 rounded-full overflow-hidden border border-hairline">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${storagePercent}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className={`h-full rounded-full ${
                storagePercent > 80
                  ? 'bg-gradient-to-r from-amber-500 to-red-500'
                  : 'bg-gradient-to-r from-primary to-secondary'
              }`}
            />
          </div>

          {storagePercent > 80 && (
            <p className="text-xs text-amber-500 font-medium">
              {storagePercent > 95
                ? 'Storage nearly full. Upgrade to continue.'
                : 'Storage running low. Consider upgrading soon.'}
            </p>
          )}
        </Card>
      </motion.div>

      {/* Tier features - conditional based on FREE vs PAID */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Hosting type */}
        <Card className="p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-mut mb-2">
            Hosting Type
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              </svg>
              <span className="text-sm text-ink">IPFS Hosting</span>
              <span className="text-xs text-live ml-auto">Always Included</span>
            </div>

            {isPaid && (
              <div className="flex items-center gap-2 pt-1.5 border-t border-hairline">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
                  <path d="M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2z" />
                </svg>
                <span className="text-sm text-ink">Custom Backend</span>
                <Badge variant="success" className="ml-auto text-[10px]">Available</Badge>
              </div>
            )}
          </div>
        </Card>

        {/* Database support */}
        <Card className="p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-mut mb-2">
            Database
          </p>
          {isPaid ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
                  <path d="M12 3C6.48 3 2 5.24 2 8v8c0 2.76 4.48 5 10 5s10-2.24 10-5V8c0-2.76-4.48-5-10-5z" />
                </svg>
                <span className="text-sm text-ink">PostgreSQL</span>
                <Badge variant="success" className="ml-auto text-[10px]">Available</Badge>
              </div>
              <div className="flex items-center gap-2 pt-1.5 border-t border-hairline">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-secondary">
                  <path d="M12 3C6.48 3 2 5.24 2 8v8c0 2.76 4.48 5 10 5s10-2.24 10-5V8c0-2.76-4.48-5-10-5z" />
                </svg>
                <span className="text-sm text-ink">SQLite</span>
                <Badge variant="default" className="ml-auto text-[10px]">Embedded</Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-mut">
              Upgrade to Paid tier to unlock backend & database support.
            </p>
          )}
        </Card>
      </motion.div>

      {/* Call to action - only show if free tier */}
      {!isPaid && (
        <motion.div variants={itemVariants}>
          <Card className="relative overflow-hidden bg-gradient-to-br from-primary/20 via-surface-900 to-secondary/20 border-primary/30 p-4">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary/30 to-transparent rounded-full -mr-16 -mt-16" />
            <div className="relative z-10 space-y-3">
              <div>
                <h3 className="text-base font-bold text-ink font-display">
                  Ready to scale up?
                </h3>
                <p className="text-sm text-ink-mut mt-1">
                  Get custom domains, backends, and databases with Paid tiers.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={onUpgrade}
                isLoading={isLoading}
              >
                Explore Plans
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Quick actions */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 gap-3">
        <Button
          variant="secondary"
          className="justify-center"
          onClick={onCreateProject}
          disabled={projectsCount >= projectsLimit}
        >
          + New Project
        </Button>
        <Button variant="ghost" className="justify-center">
          View All Projects
        </Button>
      </motion.div>
    </motion.div>
  );
}
