export type Employee = {
  id: string;
  fullName: string;
  registrationNumber: string;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeInput = Pick<Employee, 'fullName' | 'registrationNumber'> & {id?: string};
export type EmployeeCollection = {employees: Employee[]; canManage: boolean};
