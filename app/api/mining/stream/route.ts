import { NextResponse } from 'next/server';
import { miningOrchestrator } from '@/lib/mining/orchestrator';
import { MiningEvent } from '@/lib/mining/types';

export async function GET() {
  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial stats
      try {
        const initialStats = miningOrchestrator.getStats();
        const data = `data: ${JSON.stringify({ type: 'stats', stats: initialStats })}\n\n`;
        controller.enqueue(encoder.encode(data));
      } catch (error) {
        console.error('Error sending initial stats:', error);
      }

      // Set up event listeners
      const onEvent = (event: MiningEvent) => {
        if (isClosed) return;
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch (error) {
          console.error('Error sending event:', error);
          isClosed = true;
        }
      };

      miningOrchestrator.on('status', onEvent);
      miningOrchestrator.on('solution', onEvent);
      miningOrchestrator.on('stats', onEvent);
      miningOrchestrator.on('error', onEvent);
      miningOrchestrator.on('mining_start', onEvent);
      miningOrchestrator.on('hash_progress', onEvent);
      miningOrchestrator.on('solution_submit', onEvent);
      miningOrchestrator.on('solution_result', onEvent);
      miningOrchestrator.on('registration_progress', onEvent);
      miningOrchestrator.on('worker_update', onEvent);

      // Send periodic stats updates
      const statsInterval = setInterval(() => {
        if (isClosed) return;
        try {
          const stats = miningOrchestrator.getStats();
          const data = `data: ${JSON.stringify({ type: 'stats', stats })}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch (error) {
          console.error('Error sending periodic stats:', error);
          isClosed = true;
          clearInterval(statsInterval);
        }
      }, 5000); // Every 5 seconds

      // Cleanup on close
      const cleanup = () => {
        isClosed = true;
        clearInterval(statsInterval);
        miningOrchestrator.off('status', onEvent);
        miningOrchestrator.off('solution', onEvent);
        miningOrchestrator.off('stats', onEvent);
        miningOrchestrator.off('error', onEvent);
        miningOrchestrator.off('mining_start', onEvent);
        miningOrchestrator.off('hash_progress', onEvent);
        miningOrchestrator.off('solution_submit', onEvent);
        miningOrchestrator.off('solution_result', onEvent);
        miningOrchestrator.off('registration_progress', onEvent);
        miningOrchestrator.off('worker_update', onEvent);
      };

      // Handle client disconnect
      return cleanup;
    },
    cancel() {
      isClosed = true;
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
