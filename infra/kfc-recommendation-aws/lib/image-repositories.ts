import { CfnParameter, RemovalPolicy } from "aws-cdk-lib";
import {
  Repository,
  RepositoryEncryption,
  TagMutability,
  type IRepository,
} from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";

export interface ImageRepositories {
  readonly mainRepository: IRepository;
  readonly scorerRepository: IRepository;
  readonly adotRepository: IRepository;
}

const repository = (scope: Construct, id: string, name: string): Repository =>
  new Repository(scope, id, {
    repositoryName: name,
    imageScanOnPush: true,
    imageTagMutability: TagMutability.IMMUTABLE,
    encryption: RepositoryEncryption.AES_256,
    removalPolicy: RemovalPolicy.RETAIN,
    emptyOnDelete: false,
  });

export const createFoundationRepositories = (scope: Construct): ImageRepositories => ({
  mainRepository: repository(scope, "MainRepository", "kfc-recommendation-main"),
  scorerRepository: repository(scope, "ScorerRepository", "kfc-recommendation-scorer"),
  adotRepository: repository(scope, "AdotRepository", "kfc-recommendation-adot"),
});

const repositoryNameParameter = (
  scope: Construct,
  id: string,
  defaultName: string,
): CfnParameter =>
  new CfnParameter(scope, id, {
    type: "String",
    default: defaultName,
    allowedPattern: "^[a-z0-9]+(?:[._/-][a-z0-9]+)*$",
    description: "Pre-existing immutable ECR repository created by the foundation phase",
  });

export const importServiceRepositories = (scope: Construct): ImageRepositories => {
  const main = repositoryNameParameter(scope, "MainRepositoryName", "kfc-recommendation-main");
  const scorer = repositoryNameParameter(scope, "ScorerRepositoryName", "kfc-recommendation-scorer");
  const adot = repositoryNameParameter(scope, "AdotRepositoryName", "kfc-recommendation-adot");
  return {
    mainRepository: Repository.fromRepositoryName(scope, "ImportedMainRepository", main.valueAsString),
    scorerRepository: Repository.fromRepositoryName(scope, "ImportedScorerRepository", scorer.valueAsString),
    adotRepository: Repository.fromRepositoryName(scope, "ImportedAdotRepository", adot.valueAsString),
  };
};
