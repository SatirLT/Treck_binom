// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "BinomTracker",
    platforms: [
        .iOS(.v14)
    ],
    products: [
        .library(
            name: "BinomTracker",
            targets: ["BinomTracker"]
        ),
    ],
    targets: [
        .target(
            name: "BinomTracker",
            path: "Sources/BinomTracker"
        ),
    ]
)
