#!/bin/bash

# =============================================================================
# Valerix Load Test Script
# =============================================================================
# This script runs automated load tests against the Order Service to verify
# behavior under stress, including with Gremlin latency enabled.
#
# Usage:
#   ./tests/load-test.sh [options]
#
# Options:
#   --orders N       Number of orders to create (default: 20)
#   --gremlin        Enable Gremlin latency during test
#   --schrodinger    Enable Schrödinger crash during test
#   --help           Show this help message
# =============================================================================

# Configuration
ORDER_SERVICE_URL="${ORDER_SERVICE_URL:-http://localhost:3001}"
INVENTORY_SERVICE_URL="${INVENTORY_SERVICE_URL:-http://localhost:3002}"
TOTAL_ORDERS=${TOTAL_ORDERS:-20}
ENABLE_GREMLIN=false
ENABLE_SCHRODINGER=false
RESULTS_DIR="./tests/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="${RESULTS_DIR}/load_test_${TIMESTAMP}.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --orders)
            TOTAL_ORDERS="$2"
            shift 2
            ;;
        --gremlin)
            ENABLE_GREMLIN=true
            shift
            ;;
        --schrodinger)
            ENABLE_SCHRODINGER=true
            shift
            ;;
        --help)
            head -20 "$0" | tail -15
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Counters
SUCCESSFUL=0
FAILED=0
TIMED_OUT=0
PENDING_VERIFICATION=0
TOTAL_DURATION=0

# Create results directory
mkdir -p "$RESULTS_DIR"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           VALERIX LOAD TEST - Starting                        ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Configuration:"
echo "  Order Service:     ${ORDER_SERVICE_URL}"
echo "  Total Orders:      ${TOTAL_ORDERS}"
echo "  Gremlin Mode:      ${ENABLE_GREMLIN}"
echo "  Schrödinger Mode:  ${ENABLE_SCHRODINGER}"
echo "  Results File:      ${RESULTS_FILE}"
echo ""

# Check if services are healthy
echo -e "${YELLOW}Checking service health...${NC}"
ORDER_HEALTH=$(curl -s "${ORDER_SERVICE_URL}/health" 2>/dev/null || echo '{"status":"unreachable"}')
INVENTORY_HEALTH=$(curl -s "${INVENTORY_SERVICE_URL}/health" 2>/dev/null || echo '{"status":"unreachable"}')

ORDER_STATUS=$(echo "$ORDER_HEALTH" | jq -r '.status // "error"')
INVENTORY_STATUS=$(echo "$INVENTORY_HEALTH" | jq -r '.status // "error"')

if [[ "$ORDER_STATUS" != "healthy" ]]; then
    echo -e "${RED}✗ Order Service is not healthy: ${ORDER_STATUS}${NC}"
    exit 1
fi

if [[ "$INVENTORY_STATUS" != "healthy" ]]; then
    echo -e "${RED}✗ Inventory Service is not healthy: ${INVENTORY_STATUS}${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All services are healthy${NC}"
echo ""

# Enable chaos modes if requested
if [[ "$ENABLE_GREMLIN" == "true" ]]; then
    echo -e "${YELLOW}Enabling Gremlin latency mode...${NC}"
    curl -s -X POST "${INVENTORY_SERVICE_URL}/chaos/gremlin" \
        -H "Content-Type: application/json" \
        -d '{"enabled": true, "minLatencyMs": 2500, "maxLatencyMs": 4000}' > /dev/null
    echo -e "${GREEN}✓ Gremlin mode enabled (2.5-4s delay)${NC}"
fi

if [[ "$ENABLE_SCHRODINGER" == "true" ]]; then
    echo -e "${YELLOW}Enabling Schrödinger crash mode...${NC}"
    curl -s -X POST "${INVENTORY_SERVICE_URL}/chaos/schrodinger" \
        -H "Content-Type: application/json" \
        -d '{"enabled": true, "probability": 0.2}' > /dev/null
    echo -e "${GREEN}✓ Schrödinger mode enabled (20% crash probability)${NC}"
fi

echo ""

# Get available products
echo -e "${YELLOW}Fetching available products...${NC}"
PRODUCTS_JSON=$(curl -s "${INVENTORY_SERVICE_URL}/products")
PRODUCT_IDS=$(echo "$PRODUCTS_JSON" | jq -r '.data[].id' 2>/dev/null)
PRODUCT_ARRAY=()
while IFS= read -r line; do
    [[ -n "$line" ]] && PRODUCT_ARRAY+=("$line")
done <<< "$PRODUCT_IDS"
PRODUCT_COUNT=${#PRODUCT_ARRAY[@]}

if [[ $PRODUCT_COUNT -eq 0 ]] || [[ -z "${PRODUCT_ARRAY[0]}" ]]; then
    echo -e "${RED}✗ No products available${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Found ${PRODUCT_COUNT} products${NC}"
echo ""

# Run load test
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           Running Load Test (${TOTAL_ORDERS} orders)          ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

START_TEST=$(date +%s)

# Results array
RESULTS_ARRAY="["

for ((i=1; i<=TOTAL_ORDERS; i++)); do
    # Select random product
    PRODUCT_ID="${PRODUCT_ARRAY[$((RANDOM % PRODUCT_COUNT))]}"
    QUANTITY=$((RANDOM % 3 + 1))
    
    echo -n "  Order $i/$TOTAL_ORDERS: "
    
    START_TIME=$(date +%s%3N)
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${ORDER_SERVICE_URL}/orders" \
        -H "Content-Type: application/json" \
        -d "{\"customerId\": \"load-test-user-${i}\", \"productId\": \"${PRODUCT_ID}\", \"quantity\": ${QUANTITY}}" \
        --max-time 10 2>/dev/null || echo -e "\n000")
    
    END_TIME=$(date +%s%3N)
    DURATION=$((END_TIME - START_TIME))
    TOTAL_DURATION=$((TOTAL_DURATION + DURATION))
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    STATUS="unknown"
    ORDER_ID=""
    MESSAGE=""
    
    if [[ "$HTTP_CODE" == "000" ]]; then
        STATUS="timeout"
        MESSAGE="Request timed out"
        ((TIMED_OUT++))
        echo -e "${RED}TIMEOUT${NC} (${DURATION}ms)"
    elif [[ "$HTTP_CODE" == "201" ]] || [[ "$HTTP_CODE" == "200" ]]; then
        ORDER_ID=$(echo "$BODY" | jq -r '.data.id // ""')
        ORDER_STATUS=$(echo "$BODY" | jq -r '.data.status // ""')
        if [[ "$ORDER_STATUS" == "confirmed" ]]; then
            STATUS="confirmed"
            ((SUCCESSFUL++))
            echo -e "${GREEN}CONFIRMED${NC} (${DURATION}ms)"
        elif [[ "$ORDER_STATUS" == "pending_verification" ]]; then
            STATUS="pending_verification"
            ((PENDING_VERIFICATION++))
            echo -e "${YELLOW}PENDING${NC} (${DURATION}ms)"
        else
            STATUS="$ORDER_STATUS"
            ((FAILED++))
            echo -e "${RED}${STATUS}${NC} (${DURATION}ms)"
        fi
    elif [[ "$HTTP_CODE" == "202" ]]; then
        ORDER_ID=$(echo "$BODY" | jq -r '.data.id // ""')
        STATUS="pending_verification"
        ((PENDING_VERIFICATION++))
        echo -e "${YELLOW}PENDING${NC} (${DURATION}ms)"
    elif [[ "$HTTP_CODE" == "400" ]]; then
        STATUS="failed"
        MESSAGE=$(echo "$BODY" | jq -r '.error // "Unknown error"')
        ((FAILED++))
        echo -e "${RED}FAILED: ${MESSAGE}${NC} (${DURATION}ms)"
    else
        STATUS="error"
        MESSAGE="HTTP ${HTTP_CODE}"
        ((FAILED++))
        echo -e "${RED}ERROR: HTTP ${HTTP_CODE}${NC} (${DURATION}ms)"
    fi
    
    # Add to results array
    if [[ $i -gt 1 ]]; then
        RESULTS_ARRAY="${RESULTS_ARRAY},"
    fi
    RESULTS_ARRAY="${RESULTS_ARRAY}{\"order_num\":${i},\"order_id\":\"${ORDER_ID}\",\"product_id\":\"${PRODUCT_ID}\",\"quantity\":${QUANTITY},\"status\":\"${STATUS}\",\"duration_ms\":${DURATION},\"http_code\":${HTTP_CODE}}"
done

RESULTS_ARRAY="${RESULTS_ARRAY}]"

END_TEST=$(date +%s)
TEST_DURATION=$((END_TEST - START_TEST))
AVG_DURATION=$((TOTAL_DURATION / TOTAL_ORDERS))

echo ""

# Disable chaos modes
if [[ "$ENABLE_GREMLIN" == "true" ]]; then
    echo -e "${YELLOW}Disabling Gremlin mode...${NC}"
    curl -s -X POST "${INVENTORY_SERVICE_URL}/chaos/gremlin" \
        -H "Content-Type: application/json" \
        -d '{"enabled": false}' > /dev/null
fi

if [[ "$ENABLE_SCHRODINGER" == "true" ]]; then
    echo -e "${YELLOW}Disabling Schrödinger mode...${NC}"
    curl -s -X POST "${INVENTORY_SERVICE_URL}/chaos/schrodinger" \
        -H "Content-Type: application/json" \
        -d '{"enabled": false}' > /dev/null
fi

# Save results
cat > "$RESULTS_FILE" << EOF
{
  "test_config": {
    "timestamp": "$(date -Iseconds)",
    "total_orders": ${TOTAL_ORDERS},
    "gremlin_enabled": ${ENABLE_GREMLIN},
    "schrodinger_enabled": ${ENABLE_SCHRODINGER}
  },
  "summary": {
    "successful": ${SUCCESSFUL},
    "pending_verification": ${PENDING_VERIFICATION},
    "failed": ${FAILED},
    "timed_out": ${TIMED_OUT},
    "total_duration_seconds": ${TEST_DURATION},
    "avg_response_ms": ${AVG_DURATION}
  },
  "results": ${RESULTS_ARRAY}
}
EOF

# Print summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    TEST RESULTS SUMMARY                        ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Total Orders:           ${TOTAL_ORDERS}"
echo "  Test Duration:          ${TEST_DURATION}s"
echo "  Avg Response Time:      ${AVG_DURATION}ms"
echo ""
echo -e "  ${GREEN}✓ Confirmed:${NC}            ${SUCCESSFUL}"
echo -e "  ${YELLOW}⏳ Pending Verification:${NC} ${PENDING_VERIFICATION}"
echo -e "  ${RED}✗ Failed:${NC}               ${FAILED}"
echo -e "  ${RED}⏱ Timed Out:${NC}            ${TIMED_OUT}"
echo ""

# Calculate success rate
TOTAL_PROCESSED=$((SUCCESSFUL + PENDING_VERIFICATION))
SUCCESS_RATE=$((TOTAL_PROCESSED * 100 / TOTAL_ORDERS))

if [[ $SUCCESS_RATE -ge 90 ]]; then
    echo -e "  Success Rate:           ${GREEN}${SUCCESS_RATE}%${NC}"
elif [[ $SUCCESS_RATE -ge 70 ]]; then
    echo -e "  Success Rate:           ${YELLOW}${SUCCESS_RATE}%${NC}"
else
    echo -e "  Success Rate:           ${RED}${SUCCESS_RATE}%${NC}"
fi

echo ""
echo "  Results saved to: ${RESULTS_FILE}"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Exit with error if too many failures
if [[ $SUCCESS_RATE -lt 50 ]]; then
    echo -e "${RED}Test failed: Success rate below 50%${NC}"
    exit 1
fi

exit 0
