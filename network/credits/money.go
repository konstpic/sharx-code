package credits

import (
	"errors"
	"math"
	"math/big"
	"strconv"
)

const MicrosPerCredit int64 = 1000000
const BytesPerGB int64 = 1000000000
const MaxMoneyMicros int64 = 1000000000000000 // one billion credits; fits exact API integer range

// Micros is a boundary conversion. Internal accounting uses integer microcredits.
func Micros(credits float64) (int64, error) {
	if math.IsNaN(credits) || math.IsInf(credits, 0) || math.Abs(credits) > float64(MaxMoneyMicros)/float64(MicrosPerCredit) {
		return 0, errors.New("invalid credit amount")
	}
	scaled := credits * float64(MicrosPerCredit)
	rounded := math.Round(scaled)
	// Allow representation error from the compatible float API, not extra
	// decimal precision. One ULP is needed near the upper accounting bound.
	tolerance := math.Max(0.00001, math.Abs(math.Nextafter(scaled, math.Inf(1))-scaled))
	if math.Abs(scaled-rounded) > tolerance {
		return 0, errors.New("credit amount must use at most six decimals")
	}
	return int64(rounded), nil
}
func Credits(micros int64) float64 { return float64(micros) / float64(MicrosPerCredit) }
func Decimal(micros int64) string {
	sign := ""
	if micros < 0 {
		sign = "-"
		micros = -micros
	}
	fraction := strconv.FormatInt(micros%MicrosPerCredit+MicrosPerCredit, 10)[1:]
	return sign + strconv.FormatInt(micros/MicrosPerCredit, 10) + "." + fraction
}

// Cost rounds the cumulative amount up once. Splitting reports cannot change cost.
func Cost(bytes, rateMicros int64) (int64, error) {
	if bytes < 0 || rateMicros <= 0 {
		return 0, errors.New("invalid traffic cost")
	}
	product := new(big.Int).Mul(big.NewInt(bytes), big.NewInt(rateMicros))
	product.Add(product, big.NewInt(BytesPerGB-1)).Quo(product, big.NewInt(BytesPerGB))
	if !product.IsInt64() || product.Int64() > MaxMoneyMicros {
		return 0, errors.New("traffic cost overflow")
	}
	return product.Int64(), nil
}
func QuotaBytes(gb float64) (int64, error) {
	if math.IsNaN(gb) || math.IsInf(gb, 0) || gb < 0.1 || gb > 10000 {
		return 0, errors.New("quota_gb out of range (0.1..10000)")
	}
	// Whole bytes are the contractual unit; reject rather than silently enlarge a quota.
	scaled := gb * float64(BytesPerGB)
	if math.Abs(scaled-math.Round(scaled)) > 0.01 {
		return 0, errors.New("quota must represent whole bytes")
	}
	return int64(math.Round(scaled)), nil
}
