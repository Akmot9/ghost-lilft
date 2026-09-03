// swift-tools-version:5.5

import PackageDescription

let package = Package(
  name: "tauri-plugin-rest-activity",
  platforms: [
    .iOS(.v13)
  ],
  products: [
    .library(
      name: "tauri-plugin-rest-activity",
      type: .static,
      targets: ["tauri-plugin-rest-activity"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-rest-activity",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
