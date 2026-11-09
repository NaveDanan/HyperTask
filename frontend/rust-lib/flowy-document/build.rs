fn main() {
  flowy_codegen::protobuf_file::generate(env!("CARGO_PKG_NAME"));
}
