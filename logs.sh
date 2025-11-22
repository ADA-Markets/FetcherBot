#!/bin/bash
# ============================================================================
# Fetcher Bot - View Logs
# ============================================================================
# Tail logs from both services
# Usage: ./logs.sh [hash|nextjs|all]
# ============================================================================

cd "$(dirname "$0")"

MODE=${1:-all}

echo ""
echo "================================================================================"
echo "                    Fetcher Bot - Logs"
echo "================================================================================"
echo ""
echo "Press Ctrl+C to stop viewing logs"
echo ""

case $MODE in
    hash)
        echo "Viewing Hash Server logs (logs/hash-server.log)..."
        echo "─────────────────────────────────────────────────────────────────────────────"
        tail -f logs/hash-server.log
        ;;

    nextjs|next)
        echo "Viewing Next.js logs (logs/nextjs.log)..."
        echo "─────────────────────────────────────────────────────────────────────────────"
        tail -f logs/nextjs.log
        ;;

    all|*)
        echo "Viewing all logs (hash-server + nextjs)..."
        echo "─────────────────────────────────────────────────────────────────────────────"
        echo ""

        # Check if multitail is available
        if command -v multitail > /dev/null 2>&1; then
            multitail -l "tail -f logs/hash-server.log" -l "tail -f logs/nextjs.log"
        else
            # Fallback: use tail with both files
            echo "💡 Tip: Install 'multitail' for better multi-file log viewing"
            echo "   sudo apt install multitail"
            echo ""
            tail -f logs/hash-server.log logs/nextjs.log
        fi
        ;;
esac
