/**
 * In-app support ticket service.
 *
 * Pi-only app compliance: there is no email support channel, so this is the
 * sole way a user can reach the operator. Honest lifecycle — a ticket stays
 * OPEN/AWAITING_* until an operator or the user explicitly closes it. Nothing
 * here fakes a "resolved" state.
 */
import { prisma } from '../utils/prismaClient';

const MAX_SUBJECT_LEN = 120;
const MAX_BODY_LEN = 4000;
const MAX_OPEN_TICKETS_PER_USER = 10;

export class SupportTicketValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupportTicketValidationError';
  }
}

export class SupportTicketLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupportTicketLimitError';
  }
}

function assertNonEmpty(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new SupportTicketValidationError(`${field} is required`);
  if (trimmed.length > max) {
    throw new SupportTicketValidationError(`${field} must be ${max} characters or fewer`);
  }
  return trimmed;
}

export async function createTicket(userId: string, subject: string, body: string) {
  const cleanSubject = assertNonEmpty(subject, 'Subject', MAX_SUBJECT_LEN);
  const cleanBody = assertNonEmpty(body, 'Message', MAX_BODY_LEN);

  const openCount = await prisma.supportTicket.count({
    where: { userId, status: { not: 'CLOSED' } },
  });
  if (openCount >= MAX_OPEN_TICKETS_PER_USER) {
    throw new SupportTicketLimitError(
      `You have reached the limit of ${MAX_OPEN_TICKETS_PER_USER} open tickets. Please close an existing ticket before opening a new one.`,
    );
  }

  return prisma.supportTicket.create({
    data: {
      userId,
      subject: cleanSubject,
      status: 'OPEN',
      messages: {
        create: { fromOperator: false, body: cleanBody },
      },
    },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function listTickets(userId: string) {
  return prisma.supportTicket.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

export async function getTicket(userId: string, ticketId: string) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!ticket) return null;
  return ticket;
}

export async function addUserReply(userId: string, ticketId: string, body: string) {
  const cleanBody = assertNonEmpty(body, 'Message', MAX_BODY_LEN);

  const ticket = await prisma.supportTicket.findFirst({ where: { id: ticketId, userId } });
  if (!ticket) return null;
  if (ticket.status === 'CLOSED') {
    throw new SupportTicketValidationError('This ticket is closed. Open a new ticket to continue.');
  }

  await prisma.supportTicketMessage.create({
    data: { ticketId, fromOperator: false, body: cleanBody },
  });

  return prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: 'AWAITING_OPERATOR', updatedAt: new Date() },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function closeTicket(userId: string, ticketId: string) {
  const ticket = await prisma.supportTicket.findFirst({ where: { id: ticketId, userId } });
  if (!ticket) return null;

  return prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: 'CLOSED', closedAt: new Date() },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
}
