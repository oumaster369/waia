// DEE-998 bounded experiment, NOT selected by any application execution path.
// Compile: C++17, -O3 -fno-fast-math -ffp-contract=off; link OpenSSL 3 libcrypto.
// Input on stdin: WAIAVB01, u32LE n/start/end, 32 trial bytes, n binary64LE values.
// Output has no p-value, admission or checkpoint write capability.
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <vector>
#if __has_include(<openssl/sha.h>)
#include <openssl/sha.h>
#include <openssl/crypto.h>
#else
// Public OpenSSL 3 SHA256_CTX layout. Deliberately bounded to OpenSSL 3;
// installed-binary Node parity is mandatory, not inferred from ABI size alone.
// https://docs.openssl.org/master/man3/SHA256_Init/
struct SHA256_CTX { unsigned int h[8], Nl, Nh, data[16], num, md_len; };
extern "C" void SHA256_Transform(SHA256_CTX*, const unsigned char*);
extern "C" unsigned char* SHA256(const unsigned char*, size_t, unsigned char*);
extern "C" unsigned long OpenSSL_version_num();
#endif

namespace {
constexpr uint32_t MAX_N = 1'000'000;
constexpr uint32_t B = 10'000;
using Bytes32 = std::array<unsigned char, 32>;
static_assert(sizeof(double) == 8 && std::numeric_limits<double>::is_iec559);
static_assert(sizeof(unsigned int) == 4 && sizeof(SHA256_CTX) == 112);
#ifdef __FAST_MATH__
#error Fast math invalidates the reference arithmetic contract
#endif
void require(bool condition) { if (!condition) throw std::runtime_error("refused"); }
double checkedFinite(double value) { require(std::isfinite(value)); return value; }
void readExact(unsigned char* to, size_t size) {
  std::cin.read(reinterpret_cast<char*>(to), static_cast<std::streamsize>(size));
  require(static_cast<size_t>(std::cin.gcount()) == size);
}
uint32_t le32(const unsigned char* p) {
  uint32_t out = 0; for (int j = 3; j >= 0; --j) out = (out << 8) | p[j]; return out;
}
void be32(unsigned char* p, uint32_t value) {
  for (int j = 3; j >= 0; --j) { p[j] = value & 255; value >>= 8; }
}
uint64_t doubleBits(double value) { uint64_t bits; std::memcpy(&bits, &value, 8); return bits; }
std::string hex64(uint64_t value) {
  std::ostringstream out; out << std::hex << std::setfill('0') << std::setw(16) << value; return out.str();
}
std::string hex32(const Bytes32& bytes) {
  std::ostringstream out; out << std::hex << std::setfill('0');
  for (auto b : bytes) out << std::setw(2) << static_cast<unsigned>(b); return out.str();
}
Bytes32 hash(const unsigned char* p, size_t size) {
  Bytes32 result{}; require(SHA256(p, size, result.data()) != nullptr); return result;
}

class Sampler {
  std::array<unsigned char, 64> message{};
  uint64_t rejections = 0;
  static uint64_t firstWord(const std::array<unsigned char, 64>& bytes) {
#ifdef WAIA_NATIVE_REFERENCE_SHA
    const auto digest = hash(bytes.data(), bytes.size());
    uint64_t word = 0; for (int j = 0; j < 8; ++j) word = (word << 8) | digest[j];
    return word;
#else
    // Exactly one 64-byte input plus SHA256's second padding block, 512-bit length.
    SHA256_CTX state{};
    constexpr unsigned int iv[8] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
      0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    std::memcpy(state.h, iv, 32);
    std::array<unsigned char, 64> padding{}; padding[0] = 0x80; padding[62] = 2;
    SHA256_Transform(&state, bytes.data()); SHA256_Transform(&state, padding.data());
    return (static_cast<uint64_t>(state.h[0]) << 32) | state.h[1];
#endif
  }
public:
  explicit Sampler(const Bytes32& root) {
    std::memcpy(message.data(), "WAIACBR1VALBOOT1", 16);
    std::memcpy(message.data() + 16, root.data(), 32);
  }
  uint64_t rejectionCount() const { return rejections; }
  uint64_t draw(uint32_t ordinal, uint32_t position, uint32_t drawOrdinal, uint64_t bound) {
    require(bound > 0 && bound <= 9007199254740991ULL);
    be32(message.data() + 48, ordinal); be32(message.data() + 52, position);
    be32(message.data() + 56, drawOrdinal);
    const unsigned __int128 total = static_cast<unsigned __int128>(1) << 64;
    const auto limit = total - total % bound;
    for (uint32_t retry = 0;; ++retry) {
      be32(message.data() + 60, retry);
      const uint64_t word = firstWord(message);
      if (static_cast<unsigned __int128>(word) < limit) return word % bound;
      require(retry != std::numeric_limits<uint32_t>::max());
      ++rejections;
    }
  }
};

// Fixed synthetic probe shares the actual Sampler, including forced-by-large-bound
// rejection events. It cannot accept a caller-supplied RNG or override science.
void samplerSelfTest() {
  Bytes32 root{}; root.fill(42); Sampler sampler(root);
  constexpr uint32_t count = 1'000'000;
  constexpr uint64_t bounds[] = {81, 525547, 4503599627370497ULL};
  std::vector<unsigned char> output(count * 8);
  for (uint32_t i = 0; i < count; ++i) {
    uint64_t value = sampler.draw(i % 10000, i, i % 2, bounds[i % 3]);
    for (int j = 7; j >= 0; --j) { output[i * 8 + j] = value & 255; value >>= 8; }
  }
  const auto digest = hex32(hash(output.data(), output.size()));
  require(digest == "b2f4534b38591bf7ad0cad059dc75b443b571558bde158764806790ab8ffd412");
  require(sampler.rejectionCount() == 80);
  std::cout << "{\"kind\":\"synthetic-shared-sampler-self-test\",\"count\":" << count
    << ",\"rejections\":" << sampler.rejectionCount() << ",\"outputDigest\":\"" << digest << "\"}\n";
}
}

int main(int argc, char** argv) {
  try {
    const auto version = OpenSSL_version_num();
    require((version >> 28) == 3);
    if (argc == 2 && std::strcmp(argv[1], "--self-test-rng") == 0) { samplerSelfTest(); return 0; }
    require(argc == 1);
    std::array<unsigned char, 52> header{}; readExact(header.data(), header.size());
    require(std::memcmp(header.data(), "WAIAVB01", 8) == 0);
    const uint32_t n = le32(header.data() + 8), start = le32(header.data() + 12),
      end = le32(header.data() + 16);
    require(n > 0 && n <= MAX_N && start < end && end <= B);
    std::vector<double> centered(n);
    double sum = 0;
    for (auto& value : centered) {
      std::array<unsigned char, 8> bytes{}; readExact(bytes.data(), bytes.size());
      uint64_t bits = 0; for (int j = 7; j >= 0; --j) bits = (bits << 8) | bytes[j];
      std::memcpy(&value, &bits, 8); sum = checkedFinite(sum + checkedFinite(value));
    }
    require(std::cin.get() == std::char_traits<char>::eof());
    const double dBar = checkedFinite(sum / n), sqrtN = std::sqrt(static_cast<double>(n));
    const double tObs = checkedFinite(sqrtN * dBar);
    sum = 0;
    for (auto& value : centered) { value = checkedFinite(value - dBar); sum = checkedFinite(sum + value); }
    const double centeredMean = checkedFinite(sum / n);
    // Frozen prefix is 15 bytes despite its historical *_16 constant name.
    constexpr char rootPrefix[] = "WAIAVALBOOTROOT1";
    std::array<unsigned char, sizeof(rootPrefix) - 1 + 32> rootMessage{};
    std::memcpy(rootMessage.data(), rootPrefix, sizeof(rootPrefix) - 1);
    std::memcpy(rootMessage.data() + sizeof(rootPrefix) - 1, header.data() + 20, 32);
    const auto root = hash(rootMessage.data(), rootMessage.size());
    Sampler sampler(root);
    uint32_t length = 1; while (static_cast<uint64_t>(length) * length * length < n) ++length;
    uint32_t extremeCount = 0;
    std::vector<unsigned char> statisticBytes((end - start) * 8);
    for (uint32_t b = start; b < end; ++b) {
      uint32_t index = sampler.draw(b, 0, 0, n); double sampledSum = checkedFinite(0.0 + centered[index]);
      for (uint32_t position = 1; position < n; ++position) {
        index = sampler.draw(b, position, 1, length) == 0
          ? sampler.draw(b, position, 0, n) : (index + 1) % n;
        sampledSum = checkedFinite(sampledSum + centered[index]);
      }
      const double statistic = checkedFinite(sqrtN * (sampledSum / n));
      if (statistic >= tObs) ++extremeCount;
      uint64_t bits = doubleBits(statistic);
      for (int j = 7; j >= 0; --j) { statisticBytes[(b - start) * 8 + j] = bits & 255; bits >>= 8; }
    }
    const auto digest = hash(statisticBytes.data(), statisticBytes.size());
    std::cout << "{\"version\":\"native-bootstrap-range-experiment/v1\",\"n\":" << n
      << ",\"start\":" << start << ",\"endExclusive\":" << end
      << ",\"extremeCount\":" << extremeCount
      << ",\"dBarBits\":\"" << hex64(doubleBits(dBar)) << "\",\"tObsBits\":\""
      << hex64(doubleBits(tObs)) << "\",\"centeredMeanBits\":\"" << hex64(doubleBits(centeredMean))
      << "\",\"statisticDigest\":\"" << hex32(digest) << "\",\"rootHex\":\"" << hex32(root)
      << "\",\"admission\":\"NOT_ESTABLISHED\"}\n";
    return 0;
  } catch (...) { std::cerr << "NATIVE_BOOTSTRAP_RANGE_REFUSED\n"; return 1; }
}
