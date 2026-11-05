package credits

import (
	"math"
	"testing"
)

func TestCumulativeCostCannotDependOnReportSplitting(t *testing.T) {
	for _, rate := range []int64{100000, 1000000, 10000000} {
		var paid int64
		for bytes := int64(1); bytes <= 100000; bytes += 37 {
			target, err := Cost(bytes, rate)
			if err != nil {
				t.Fatal(err)
			}
			delta := target - paid
			if delta < 0 {
				t.Fatal("negative payment")
			}
			paid += delta
			whole, _ := Cost(bytes, rate)
			if paid != whole {
				t.Fatal("chunking changed price")
			}
		}
	}
}
func TestMoneyRejectsInvalidAndKeepsExactUnits(t *testing.T) {
	for _, v := range []float64{math.NaN(), math.Inf(1), .0000001, 1e12} {
		if _, err := Micros(v); err == nil {
			t.Fatalf("accepted %v", v)
		}
	}
	for _, m := range []int64{0, 1, -1, 123456789, 99999999999, MaxMoneyMicros - 1} {
		v, err := Micros(Credits(m))
		if err != nil || v != m {
			t.Fatal(m, v, err)
		}
	}
	if Decimal(-1) != "-0.000001" {
		t.Fatal(Decimal(-1))
	}
	if n, _ := Cost(3200, 1000000); n != 4 {
		t.Fatal(n)
	}
	if _, err := Cost(math.MaxInt64, MaxMoneyMicros); err == nil {
		t.Fatal("overflow accepted")
	}
}

func TestExactMicrocreditBoundaryRoundtrip(t *testing.T) {
	for n := int64(1); n < MaxMoneyMicros; n = n*3 + 71 {
		for _, m := range []int64{n, n + 1, n - 1} {
			got, err := Micros(Credits(m))
			if err != nil || got != m {
				t.Fatalf("%d became %d: %v", m, got, err)
			}
		}
	}
}
