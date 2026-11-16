#![allow(unused_imports)]
#![allow(unused_attributes)]
#![allow(dead_code)]
mod ast;
mod proto_gen;
mod proto_info;
mod template;

use crate::Project;
use crate::util::path_string_with_component;
use itertools::Itertools;
use log::info;
pub use proto_gen::*;
pub use proto_info::*;
use std::fs;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

pub fn generate(crate_name: &str) {
  // 1. generate the proto files to proto_file_dir
  #[cfg(feature = "proto_gen")]
  let proto_crates = gen_proto_files(crate_name);

  for proto_crate in proto_crates {
    let mut proto_file_paths = vec![];
    let proto_file_output_path = proto_crate
      .proto_output_path()
      .to_str()
      .unwrap()
      .to_string();
    let protobuf_output_path = proto_crate
      .protobuf_crate_path()
      .to_str()
      .unwrap()
      .to_string();

    for path in WalkDir::new(&proto_file_output_path)
      .into_iter()
      .filter_map(|e| e.ok())
      .map(|e| {
        let path = e.path().to_str().unwrap().to_string();
        path
      })
    {
      if path.ends_with(".proto") {
        // https://stackoverflow.com/questions/49077147/how-can-i-force-build-rs-to-run-again-without-cleaning-my-whole-project
        println!("cargo:rerun-if-changed={}", path);
        proto_file_paths.push(path);
      }
    }
    let protoc_bin_path = protoc_bin_vendored::protoc_bin_path().unwrap();

    // Generate the Rust protobuf types.
    generate_rust_protobuf_files(
      &protoc_bin_path,
      &proto_file_paths,
      &proto_file_output_path,
      &protobuf_output_path,
    );
  }
}

fn generate_rust_protobuf_files(
  protoc_bin_path: &Path,
  proto_file_paths: &[String],
  proto_file_output_path: &str,
  protobuf_output_path: &str,
) {
  protoc_rust::Codegen::new()
    .out_dir(protobuf_output_path)
    .protoc_path(protoc_bin_path)
    .inputs(proto_file_paths)
    .include(proto_file_output_path)
    .run()
    .expect("Running rust protoc failed.");
  remove_box_pointers_lint_from_all_except_mod(protobuf_output_path);
}
fn remove_box_pointers_lint_from_all_except_mod(dir_path: &str) {
  let dir = fs::read_dir(dir_path).expect("Failed to read directory");
  for entry in dir {
    let entry = entry.expect("Failed to read directory entry");
    let path = entry.path();

    // Skip directories and mod.rs
    if path.is_file() {
      if let Some(file_name) = path.file_name().and_then(|f| f.to_str()) {
        if file_name != "mod.rs" {
          remove_box_pointers_lint(&path);
        }
      }
    }
  }
}

fn remove_box_pointers_lint(file_path: &Path) {
  let file = File::open(file_path).expect("Failed to open file");
  let reader = BufReader::new(file);
  let lines: Vec<String> = reader
    .lines()
    .map_while(Result::ok)
    .filter(|line| !line.contains("#![allow(box_pointers)]"))
    .collect();

  let mut file = File::create(file_path).expect("Failed to create file");
  for line in lines {
    writeln!(file, "{}", line).expect("Failed to write line");
  }
}

#[cfg(feature = "ts")]
fn generate_ts_protobuf_files(
  name: &str,
  proto_file_output_path: &str,
  paths: &[String],
  file_names: &Vec<String>,
  protoc_bin_path: &Path,
  project: &Project,
) {
  let root = project.model_root();
  let backend_service_path = project.dst();

  let mut output = PathBuf::new();
  output.push(root);
  output.push(backend_service_path);
  output.push("models");
  output.push(name);

  if !output.as_path().exists() {
    std::fs::create_dir_all(&output).unwrap();
  }
  let protoc_bin_path = protoc_bin_path.to_str().unwrap().to_owned();
  paths.iter().for_each(|path| {
    // if let Err(err) = Command::new(protoc_bin_path.clone())
    //   .arg(format!("--ts_out={}", output.to_str().unwrap()))
    //   .arg(format!("--proto_path={}", proto_file_output_path))
    //   .arg(path)
    //   .spawn()
    // {
    //   panic!("Generate ts pb file failed: {}, {:?}", path, err);
    // }

    println!("cargo:rerun-if-changed={}", output.to_str().unwrap());
    let result = cmd_lib::run_cmd! {
        ${protoc_bin_path} --ts_out=${output} --proto_path=${proto_file_output_path} ${path}
    };

    if result.is_err() {
      panic!("Generate ts pb file failed with: {}, {:?}", path, result)
    };
  });

  let ts_index = path_string_with_component(&output, vec!["index.ts"]);
  match std::fs::OpenOptions::new()
    .create(true)
    .write(true)
    .append(false)
    .truncate(true)
    .open(ts_index)
  {
    Ok(ref mut file) => {
      let mut export = String::new();
      export.push_str("// Auto-generated, do not edit \n");
      for file_name in file_names {
        let c = format!("export * from \"./{}\";\n", file_name);
        export.push_str(c.as_ref());
      }

      file.write_all(export.as_bytes()).unwrap();
      File::flush(file).unwrap();
    },
    Err(err) => {
      panic!("Failed to open file: {}", err);
    },
  }
}

#[cfg(feature = "proto_gen")]
pub fn gen_proto_files(crate_name: &str) -> Vec<ProtobufCrate> {
  let crate_path = std::fs::canonicalize(".")
    .unwrap()
    .as_path()
    .display()
    .to_string();

  let crate_context = ProtoGenerator::r#gen(crate_name, &crate_path);
  let proto_crates = crate_context
    .iter()
    .map(|info| info.protobuf_crate.clone())
    .collect::<Vec<_>>();

  crate_context
    .into_iter()
    .flat_map(|info| info.files)
    .for_each(|file| {
      println!("cargo:rerun-if-changed={}", file.file_path);
    });

  proto_crates
}
